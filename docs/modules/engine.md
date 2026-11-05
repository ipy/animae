# Engine (`src/engine/`)

## Purpose

Kernel wiring, hot reload, and the public `createEngine` facade ([TypeScript API](../spec.md#201-typescript-api), [Ids, time, RNG](../architecture.md#41-ids-time-rng)).

## Public API

```ts
createEngine(opts: CreateEngineOptions): Promise<Engine>
```

See `src/api.ts` for `Engine` and options. Exported from `@animae/engine` via `src/engine/index.ts`.

### `Engine.runtime`

| Method / field | Role |
|----------------|------|
| `mode()` | Current `{ appraise, render, s2Tier? }` backends |
| `pending()` | Queued mode when `switchAt: turn_boundary` |
| `switchAt` | `turn_boundary` (default) or `immediate` |
| `setMode(preset \| partial, { reason?, trigger? })` | Presets: `full`, `judge-only`, `narrate-only`, `rule`; emits `runtime.mode_changed` |
| `models()` | `ModelsInfo` for UI (`s1`/`s2` ids or `"rule"`, tier list) |

Initial mode: `createEngine({ mode })` / CLI `--mode`, then `animae.yaml` `mode` / `appraise.backend` / `render.backend` ([Section 19.3](../spec.md#193-model-configuration)). Errors: `MODE_INVALID`, `MODE_UNAVAILABLE`, `MODE_UNKNOWN_TIER`.

LLM failures may fall back per `runtime.fallbackOnError` (`runtime.fallback_used`); does not change runtime mode.

## Responsibilities

- Acquire storage lock, load authored + policy (preset registry from `opts.presets`), register preset rule fns, build CEL/rule engine, timeline (`open()`), resolve models (`opts.models` optional — missing S1/S2 ports use `createRuleModelPort`), wrap LLM ports with `withRecording` per `modelMode`, wire `runtime` mode controller ([Appendix B](../spec.md#appendix-b-runtime-modes-and-switching)).
- Live getters for `authored` / `policy` via `createLiveAuthoredPolicy`; `reload()` and turn-end stat fingerprint check call `checkHotReload`.
- Wire kernel modules: fields (director `bypassArmed`), director, world, memory, introspect, **router (`createRouter`)**, entities.
- Delegate timeline mutations to `rebuildModuleCaches` after load/rewind/switch/import.
- Scene service + `HookRegistry` for stage hooks (`(ctx, next, kernel?)` — optional third argument is the live kernel for mods that need services).

## Turn pipeline

Implemented in `pipeline/run-turn.ts` ([turn pipeline](../architecture.md#43-turn-pipeline-per-sceneturn)): hooks per stage, `input.received`, lazy catch-up on scene first turn, commit includes full turn event ids in the `done` chunk (`eventsByTurn`).

## Hot reload ([Section 13](../spec.md#13-timeline))

`checkHotReload`: mtime/size fingerprint on `Authored.files` **and** raw `mods/**` on disk, hash compare, swap on success (`config.reloaded` includes resolved `mods` record), keep old on failure (`config.error`). Refreshes mod overlay via `refreshEngineModContext` before reload. Initial fingerprint seeded with `seedAuthoredStatFingerprint`.

**Mods:** `createEngineModContext` / `prepareModOverlay` build a read-only layered `StoragePort`; `engine.mods()` reports drift vs timeline `config.mods`. See [mods.md](../mods.md).

## Cross-module fixes

- `test/rpc/duplex.ts`: NDJSON lines now terminated with `\n` so `readLines` does not coalesce messages (RPC integration tests).

## Edge cases

- Render stage hooks buffer streamed parts (no live hook streaming yet); default runs to completion then chunks are yielded.
- Same-process double `createEngine` on one root does not `LOCKED` (same pid); cross-process lock is covered in `store` tests.
