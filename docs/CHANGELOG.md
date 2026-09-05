# Changelog

## 1.0.0

First production release of the Animae monorepo and Lilium reference game.

### `@animae/engine`

- Full turn pipeline (appraise → check → adjudicate → fields → intent → route → render → commit) with deterministic RNG and append-only timeline.
- Authored data loaders (Zod schemas in `schema/authored.ts`, `schema/policy.ts`), policy merge (`$append` / `$prepend`), preset `extends` chains.
- JSON-RPC 2.0 sidecar API; `createEngine` public surface per `api.ts`.
- Record / replay / live model modes via AI SDK v7 adapter.
- Extension events documented in `events.ts` (director, fields, rules, scene lifecycle).
- **Content mods:** layered overlays, patch merge, `ModBundle`, CLI `mods` subcommands, timeline mod record + drift warnings ([mods.md](./mods.md)).

### Packages

- `@animae/preset-base` — default tracks, intent, visibility, memory baseline.
- `@animae/preset-dnd` — SRD 5.2.1 social/exploration checks and trait schema (CC BY 4.0 attribution via `notice` export).
- `@animae/tui` — Ink 8 default layout, theme, keymap, colon commands hook.
- `animae` CLI — `init`, `validate`, `run`, `inspect`, `timeline`, `serve --stdio`, compiled `dist/animae` binary.

### Lilium (`games/lilium`)

- Shipped TUI game on preset-dnd + `policies/lilium.yaml`, embedded data, `dist/lilium` binary.

### Docs

- Authoring, policy, CEL, pipeline/events, RPC, embedding, and module notes under `animae/docs/`.
