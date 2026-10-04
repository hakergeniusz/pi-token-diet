# pi-token-diet

Payload-level token trims, applied deterministically on every provider request
so the prompt-cache prefix stays stable.

Trims (measured against pi 0.99.2, `o200k_base`):

- the "Pi documentation" block in the system prompt (~309 tok) — only relevant
  when working on pi itself
- tool descriptions capped (~220 chars) and JSON-schema property descriptions
  capped (~100 chars) across every declared tool
- `<available_skills>` descriptions to their first sentence (~140 chars)

Description trimming keeps the first complete sentence when it fits the cap,
otherwise it cuts at the last word boundary. XML entities are unescaped before
measuring and re-escaped after, so a cap never lands mid-entity.

## Install

```sh
gh repo clone hakergeniusz/pi-token-diet
cp pi-token-diet/token-diet.ts ~/.pi/agent/extensions/token-diet.ts
```

Or symlink it, so the repo stays the source of truth:

```sh
ln -s ~/projects/pi-token-diet/token-diet.ts ~/.pi/agent/extensions/token-diet.ts
```

Or add to `packages` in `~/.pi/agent/settings.json`:

```json
"packages": ["git:github.com/hakergeniusz/pi-token-diet"]
```

## Determinism

Every trim is a pure function of the payload, so the same request produces the
same bytes on every pass. Nothing is rewritten mid-session, which is what keeps
the provider-side cache prefix intact.

## Failure mode

Fail-open. The whole handler is wrapped in try/catch: on any surprise the
payload goes out exactly as pi built it. A diet bug must never break a request.

## Pairs with

- [pi-result-cap](https://github.com/hakergeniusz/pi-result-cap) — bounds tool
  results at birth
- [pi-skill-loader](https://github.com/hakergeniusz/pi-skill-loader) — drops
  skill descriptions from the prompt entirely and loads them on demand