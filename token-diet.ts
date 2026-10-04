// pi-token-diet: payload-level token trims, applied deterministically on every
// provider request so the cache prefix stays stable. Never throws into the
// request path — on any surprise the payload is left untouched.
//
// Trims (measured against pi 0.99.2, o200k_base):
//   - "Pi documentation" block in the system prompt (~309 tok) — only relevant
//     when working on pi itself
//   - tool descriptions capped (~220 chars) + JSON-schema property
//     descriptions capped (~100 chars) across every declared tool
//   - <available_skills> descriptions to their first sentence (~140 chars)

const TOOL_DESC_CAP = 220;
const PARAM_DESC_CAP = 100;
const SKILL_DESC_CAP = 140;

const UNESCAPE: Record<string, string> = {
	"&amp;": "&",
	"&lt;": "<",
	"&gt;": ">",
	"&quot;": '"',
	"&apos;": "'",
};

function escapeXml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

function firstSentences(raw: string, cap: number): string {
	let s = raw.trim();
	for (const [ent, ch] of Object.entries(UNESCAPE)) s = s.split(ent).join(ch);
	if (s.length <= cap) return escapeXml(s);
	const slice = s.slice(0, cap + 1);
	const sent = slice.match(/^[\s\S]*?[.!?](?=\s|$)/);
	let out = sent && sent[0].trim().length >= 40 ? sent[0].trim() : s.slice(0, Math.max(0, s.lastIndexOf(" ", cap))).trimEnd();
	if (out.length === 0) out = s.slice(0, cap);
	return escapeXml(out);
}

function stripDocsBlock(text: string): string {
	const lines = text.split("\n");
	let i = lines.findIndex((l) => l.includes("Pi documentation (read only"));
	if (i === -1) return text;
	let j = i + 1;
	while (j < lines.length && lines[j].startsWith("- ")) j++;
	return [...lines.slice(0, i), ...lines.slice(j)].join("\n");
}

function trimSkillDescriptions(text: string): string {
	const a = text.indexOf("<available_skills>");
	const b = text.indexOf("</available_skills>");
	if (a === -1 || b === -1 || b <= a) return text;
	const region = text.slice(a, b).replace(/<description>([\s\S]*?)<\/description>/g, (_, d: string) => `<description>${firstSentences(d, SKILL_DESC_CAP)}</description>`);
	return text.slice(0, a) + region + text.slice(b);
}

function trimSystemText(text: string): string {
	return trimSkillDescriptions(stripDocsBlock(text));
}

function trimSchemaDescriptions(node: unknown, depth: number): void {
	if (!node || typeof node !== "object" || depth > 6) return;
	if (Array.isArray(node)) {
		for (const item of node) trimSchemaDescriptions(item, depth + 1);
		return;
	}
	for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
		if (k === "description" && typeof v === "string") {
			(node as Record<string, unknown>)[k] = firstSentences(v, PARAM_DESC_CAP);
		} else {
			trimSchemaDescriptions(v, depth + 1);
		}
	}
}

function trimToolList(payload: Record<string, unknown>): void {
	const tools = payload.tools;
	if (!Array.isArray(tools)) return;
	for (const t of tools) {
		if (!t || typeof t !== "object") continue;
		const fn = (t as Record<string, unknown>).function ?? t;
		if (fn && typeof fn === "object") {
			const f = fn as Record<string, unknown>;
			if (typeof f.description === "string") f.description = firstSentences(f.description, TOOL_DESC_CAP);
			trimSchemaDescriptions(f.parameters ?? f.input_schema, 0);
		}
	}
}

export default function (pi: any) {
	pi.on("before_provider_request", (event: { payload: unknown }) => {
		try {
			const p = event.payload;
			if (!p || typeof p !== "object") return;
			const payload = p as Record<string, unknown>;
			if (typeof payload.system === "string") {
				payload.system = trimSystemText(payload.system);
			} else if (Array.isArray(payload.system)) {
				for (const part of payload.system) {
					if (part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string") {
						(part as Record<string, unknown>).text = trimSystemText((part as Record<string, unknown>).text as string);
					}
				}
			}
			if (Array.isArray(payload.messages)) {
				for (const m of payload.messages) {
					if (!m || typeof m !== "object" || (m as Record<string, unknown>).role !== "system") continue;
					const content = (m as Record<string, unknown>).content;
					if (typeof content === "string") {
						(m as Record<string, unknown>).content = trimSystemText(content);
					} else if (Array.isArray(content)) {
						for (const c of content) {
							if (c && typeof c === "object" && typeof (c as Record<string, unknown>).text === "string") {
								(c as Record<string, unknown>).text = trimSystemText((c as Record<string, unknown>).text as string);
							}
						}
					}
				}
			}
			trimToolList(payload);
		} catch {
			// a diet bug must never break the request — payload stays as pi built it
		}
	});
}
