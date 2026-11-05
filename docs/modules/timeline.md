# Timeline module

## Purpose

Event-sourced branch timeline: append-only `events.jsonl`, pure reducer, snapshots, branches/rewind/carry, save slots, artifacts (COW), recordings, purge, export/import.

## Public API

- `createTimeline(deps: TimelineDeps): TimelineStore`
- `createReducer(getPolicy)`, `reduce(state, event, policy)`, `initialState(authored, policy)`
- `replayChunks(events)`, `eventMatches(pattern, kind)`
- `createRng(seed, rootBranch, key): Rng`
- `SNAPSHOT_EVERY` (200), `rebuildState(authored, policy, events, fromSnapshot?)`

## Carry (`timeline.carry`)

On `rewind(forkAt)`, the abandoned parent branch contributes post-fork entries matching each rule:

- **track** / **world_var**: emitted as `track.delta` (`reason: "carry"`) / `world.var_set` with `carriedFrom`.
- **memory**: parent `artifacts/<owner>/memory.jsonl` lines with `_seq > forkAt`, filtered by `characters`, `tags` (overlap), and CEL `when`; copied to the new branch with `carriedFrom`, plus `memory.written` events.

Then `carry.applied` summarizes copied items.

## Reducer notes

- Tiers on `track.delta` use `rules/tierFor` ([tracks, tiers, deltas](../architecture.md#42-tracks-tiers-deltas)); initial tiers use the same helper with `current = null`.
- `rule.window_opened` → `state.windows`; `rule.threshold_fired` → `state.firedThresholds`.
- `character.promoted.data` merges into `state.generated.characters` and updates live character fields when present.
- `reflection.accepted.goal_changes`: `add` / `remove` / `update` on `CharacterState.goals`.
- `budget.degraded`: appends action names to `state.budget.degraded`; payload includes `from`/`to`/`reason`/`kind_detail`.
- `route.decided`: increments `budget.turns`; when `render.backend === "llm"`, bumps `budget.s2Turns` and `budget.s2ByTier[tier]`; `escalated` increments `budget.escalated`.
- `runtime.mode_changed`: stores `state.runtime.mode`; `runtime.fallback_used`: increments `state.runtime.fallbacks`.
- `character.var_set`, `field.age`, `world.moved`, `item.moved` update live state; `info_arrival` is a no-op in projection (consumed by director/anchors).
- `scene.ended` clears `state.scene` after marking ended.

## Verification

- `test/timeline/reducer-audit.test.ts`: long mixed sequence + snapshot-vs-incremental replay equality.
- `test/conformance/section-a.test.ts`: invariants, data-root layout, and timeline checks (I2 property replay, export manifest, import branch naming, lock).
- `test/timeline/carry-memory.test.ts`: post-fork memory carry with filters and `carriedFrom`.
- `scripts/node-smoke.mjs` (`bun run smoke:node`): Node ≥24 import of built `dist/` + `createEngine` + `world.set`.

See also [spec Section 13](../spec.md#13-timeline) for normative timeline behaviour.

## Recordings (`recordings.jsonl`)

Per-branch append-only **LLM** cache (see [model.md](./model.md#recording)). Rule-backend answers are never recorded. `RecordingStore.record` skips identical last-wins responses. On `open()` in record/live mode, each branch file on the chain may be compacted in place (dedupe keys, strip legacy stream partials). Tools: `compactRecordingsFile(path)` and `compactRecordingsStorage`.

## Replay (`timeline.replay`)

Uses `replayPlan` per turn: mode from `runtime.mode_changed`, backends from `route.decided`, recordings for LLM bindings only; `runtime.fallback_used` forces rule recompute for that phase ([Appendix D](../spec.md#appendix-d-replay-semantics)). Rule-mode timelines replay byte-identically without recordings. Missing LLM recordings → `RECORDING_MISSING` with turn/key details before playback starts.

## Storage test helper

Tests should use `MemoryStorage()` from `store` (root-level paths like `animae.yaml` supported); `test/helpers/storage.ts` re-exports it.

## Performance / durability

- `append` is serialized through an internal queue; `close()` awaits pending appends before releasing the storage lock.
- `events()` holds the full ancestor chain in memory — very long sessions should rely on snapshots + tail replay (`loadLatestSnapshot`); see skipped benchmark `benchmark: open stays fast on 10k-event log`.
- `readEventsFile` runs `repairJsonlText` on open when the last JSONL line was truncated (crash mid-append).
