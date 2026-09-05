# Conformance audit — sections C (§2, §14–§16, §19–§21)

Auditor scope: tech stack/deliverables, multi-character orchestration, introspection, input/safety, policies/presets, API/CLI/RPC, TUI.  
Method: spec line → implementation → test → status. Last run: `bun test` (animae workspaces) + `bun run build` + binary smoke.

## Summary

| Area | Status |
|------|--------|
| §2 packages + single `animae` executable | **Pass** (binary at `animae/dist/animae`) |
| §14 scene turn-taking & autonomous | **Pass** |
| §15 introspection & visibility | **Pass** |
| §16 classify & safety | **Pass** |
| §19 policies & presets | **Pass** |
| §20 Engine / JSON-RPC / CLI | **Pass** (see deviations) |
| §21 TUI | **Pass** (see deviations) |

## Conformance table

| Spec (§) | Statement | Code | Test | Status |
|----------|-----------|------|------|--------|
| **2** | TS strict ESM; Node ≥24 + Bun | `packages/engine`, workspace `package.json` | `engine/scripts/node-smoke.mjs` | Pass |
| **2** | `@animae/engine`, `@animae/preset-base`, `@animae/preset-dnd`, `@animae/tui`, `animae` CLI | `packages/*` | workspace `bun test` | Pass |
| **2** | Single executable with TUI + `serve --stdio` | `packages/cli/scripts/build.ts` → `animae/dist/animae` | `cli/test/serve.integration.test.ts`, `scripts/smoke.ts` | Pass |
| **14** | Participants from `scene.start` | `scene/scene-service.ts` `start()` | `e2e/engine.e2e.test.ts` | Pass |
| **14** | `turnTaking`: `addressed` / `round_robin` / `priority: CEL` | `scene-service.ts` `pickSpeaker()` | `scene/turn-taking.test.ts` | Pass |
| **14** | `scene.autonomous` full pipeline + budget | `scene-service.ts` + `router/budget.ts` | `scene/turn-taking.test.ts`, `router/router.test.ts` | Pass |
| **14** | Shared S2 scene pool | `router/budget.ts` `sceneS2Pool` | `router/router.test.ts` | Pass |
| **15** | Built-in viewers `debug`, `author`, `gm`, `player`, `npc:<id>` | `introspect/visibility.ts`, `query.ts` | `introspect/introspect.test.ts` | Pass |
| **15** | Query paths under characters/world/ledger/events/timeline | `introspect/query.ts` | `introspect/introspect.test.ts` | Pass |
| **15** | Visibility: last match wins; no match → deny | `introspect/visibility.ts` | `introspect/introspect.test.ts` | Pass |
| **15** | `grant` / expiry events | `introspect/service.ts` | `introspect/introspect.test.ts` | Pass |
| **15** | `explain` filtered by viewer | `introspect/explain.ts` | `introspect/introspect.test.ts` | Pass |
| **15** | `on(kind)` wildcards | `timeline/replay.ts` `eventMatches`, `timeline-store.ts` | `timeline/timeline.test.ts` | Pass |
| **15** | `query` synchronous, filtered | `engine/create-engine.ts` → `introspect.query` | `introspect/introspect.test.ts` | Pass |
| **16** | Input classes in appraise | `pipeline/appraise.ts` | `pipeline/appraise.test.ts` | Pass |
| **16** | `input.response` policy | `rules/decide.ts`, `pipeline/run-turn.ts` | `rules/pipeline.test.ts` | Pass |
| **16** | Safety optional; `safety.response` modes | `pipeline/appraise.ts`, `run-turn.ts` | `pipeline/appraise.test.ts` | Pass |
| **16** | `safety.log` → `safety.flagged` | `pipeline/appraise.ts` | `pipeline/appraise.test.ts` | Pass |
| **19.1** | Policy keys accepted (schema.extend … checks) | `schema/policy.ts` `PolicySchema` | `policy/load.test.ts`, `preset-base/test/bundle.test.ts` | Pass |
| **19.2** | Preset `preset.yaml` id/extends/policies | `policy/registry.ts`, preset packages | `policy/registry.test.ts`, `preset-base/test/bundle.test.ts` | Pass |
| **19.3** | Two `ModelPort`s required at startup | `model/config.ts` `resolveEngineModels` | `engine/create-engine.test.ts`, `model/model.test.ts` | Pass |
| **19.3** | `modelMode` default `record` | `create-engine.ts` | `engine/create-engine.test.ts` | Pass |
| **19.4** | Base preset tracks/events/intent/scene/visibility | `preset-base/src/generated.ts` | `preset-base/test/bundle.test.ts`, `preset-base/test/rules.test.ts` | Pass |
| **19.5** | DnD preset + mandatory SRD notice | `preset-dnd/NOTICE`, `notice.ts`, README | `preset-dnd/test/dnd.test.ts`, `preset-base/test/bundle.test.ts` | Pass |
| **19.5** | Notice in game credits | `games/lilium/src/game/commands.ts` `:credits` | (manual / game QA) | Pass |
| **20.1** | `Engine` surface (incl. extensions) | `api.ts`, `create-engine.ts` | `e2e/engine.e2e.test.ts`, `rpc/engine-integration.test.ts` | Pass* |
| **20.2** | `animae serve --stdio`; API-shaped methods; `turn.chunk`; `subscribe`→`event` | `rpc/server.ts`, `rpc/dispatch.ts` | `rpc/server.test.ts`, `cli/test/serve.integration.test.ts` | Pass |
| **20.3** | CLI commands + `:` commands in run/plain | `cli/src/*`, `tui/commands/builtin.ts` | `cli/test/*`, `tui/test/command-parse.test.ts` | Pass |
| **21.1** | Ink 8; `query` for panels; default viewer `player` | `tui/*` | `tui/test/hooks-fake-engine.test.ts` | Pass |
| **21.1** | Layout thresholds 100 / 80×24 | `tui/layout/layout-mode.ts` | `tui/test/layout-mode.test.ts` | Pass |
| **21.1** | CJK display width | `tui/utils/display-width.ts` | `tui/test/display-width.test.ts` | Pass |
| **21.2** | Default layout regions | `tui/layout/default-layout.tsx` | `layout/default-layout.tsx` doc + harness | Pass |
| **21.3** | Keymap table | `tui/keymap/default.ts`, `TuiApp.tsx` skip typewriter | `tui/test/keymap.test.ts` | Pass |
| **21.4** | `CueRenderer` + built-in expression/action/sfx | `tui/cues/builtins.tsx` | `tui/test/cue-alignment.test.ts` | Pass |
| **21.5** | Theme YAML keys | `tui/theme/schema.ts` | `tui/test/theme.test.ts` | Pass |
| **21.6** | `runTui`, `defaultLayout`, `components`, `hooks` exports | `tui/src/index.ts` | export lists in `tui/test/hooks-fake-engine.test.ts` | Pass |

\*See deviations: shipped `Engine` includes additive helpers (`world.move`, `timeline.saves`, `timeline.events`, `reload`, `info`) documented in `api.ts`.

## Deviations

1. **`Engine` vs spec §20.1** — Contract file adds non-breaking methods: `world.move`, `timeline.saves`, `timeline.events` (unfiltered), `reload`, `info`. Async where spec shows sync void for some field/director calls (`grant`, `sidenote`, `timeline.save/load`). Intentional per `architecture.md` / `api.ts`.
2. **Theme internal shape** — YAML uses `sidePanel.width`; runtime `Theme` uses `widthPercent` (mapped in `theme/schema.ts` `mergeTheme`). Spec §21.5 YAML shape is accepted at load time.
3. **Theme colors** — Runtime theme adds `colors.dim` and `colors.border` for Ink styling; §21.5 five role colors are present and validated.
4. **`runTui` options** — Spec lists core options; package also supports `commands`, `panels`, `header`, `footer`, `initialMessage`, stream overrides (game integration).
5. **`TurnChunk`** — Optional `speaker` / `autonomous` on chunks for TUI routing (additive).
6. **`createEngine` models** — Spec shows required `models`; `CreateEngineOptions.models` is optional when `animae.yaml` defines `models` (CLI builds ports from env). Missing both paths throws `MODEL_CONFIG` with explicit message (fixed this audit).
7. **`animae init --preset`** — Previously wrote unquoted `@…` preset ids (invalid YAML). **Fixed:** quote via `JSON.stringify` (`cli/src/commands/init.ts`, test added).
8. **Binary output path** — Build script writes `animae/dist/animae`; Lilium writes `games/lilium/dist/lilium`. Root `bun run build:all && bun run smoke`.
9. **`init --preset` without built-in registry** — Still warns when preset bundle not registered; validate may pass skeleton-only until models/preset resolve at `run`/`serve`.

## Fixes applied (this audit)

- `resolveEngineModels()` + stricter `MODEL_CONFIG` when S1/S2 missing (`model/config.ts`, `create-engine.ts`).
- Tests: `engine/create-engine.test.ts`, `scene/turn-taking.test.ts`, timeline `on()` wildcard, theme/keymap spec keys, preset-dnd NOTICE, init preset quoting.
- Lilium `:credits` command surfaces `@animae/preset-dnd` `notice` (§19.5 game attribution).

## Verification commands

```bash
cd animae && bun test && bun run build
animae/dist/animae --help
animae/dist/animae init /tmp/a && animae/dist/animae --root /tmp/a validate
# JSON-RPC: packages/cli/test/serve.integration.test.ts
# Plain REPL: packages/cli/test/plain.test.ts
```
