# Engine (`src/engine/`)

## Purpose

Kernel wiring, hot reload, and the public `createEngine` facade ([TypeScript API](../spec.md#201-typescript-api), [Ids, time, RNG](../architecture.md#41-ids-time-rng)).

## Public API

```ts
createEngine(opts: CreateEngineOptions): Promise<Engine>
```

See `src/api.ts` for `Engine` and options. Exported from `@animae/engine` via `src/engine/index.ts`.

## Responsibilities

- Acquire storage lock, load authored + policy (preset registry from `opts.presets`), register preset rule fns, build CEL/rule engine, timeline (`open()`), models (`opts.models` or config-derived, wrapped with `withRecording` per `modelMode`).
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
