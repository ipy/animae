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

- Tiers on `track.delta` use `rules/tierFor` (architecture §4.2); initial tiers use the same helper with `current = null`.
- `rule.window_opened` → `state.windows`; `rule.threshold_fired` → `state.firedThresholds`.
- `character.promoted.data` merges into `state.generated.characters` and updates live character fields when present.
- `reflection.accepted.goal_changes`: `add` / `remove` / `update` on `CharacterState.goals`.
- `budget.degraded`: appends `degraded[]` (and optional `action`) to `state.budget.degraded`; `route.decided` with `tier: "s2"` bumps S2 counters.
- `character.var_set`, `field.age`, `world.moved`, `item.moved` update live state; `info_arrival` is a no-op in projection (consumed by director/anchors).
- `scene.ended` clears `state.scene` after marking ended.

## Verification

- `test/timeline/reducer-audit.test.ts`: long mixed sequence + snapshot-vs-incremental replay equality.
- `test/conformance/section-a.test.ts`: §3/§5/§13 invariant checks (I2 property replay, export manifest, import branch naming, lock).
- `test/timeline/carry-memory.test.ts`: post-fork memory carry with filters and `carriedFrom`.
- `scripts/node-smoke.mjs` (`bun run smoke:node`): Node ≥24 import of built `dist/` + `createEngine` + `world.set`.

See also `docs/conformance-a.md` for the full audit table.

## Storage test helper

Tests should use `MemoryStorage()` from `store` (root-level paths like `animae.yaml` supported); `test/helpers/storage.ts` re-exports it.

## Performance / durability

- `append` is serialized through an internal queue; `close()` awaits pending appends before releasing the storage lock.
- `events()` holds the full ancestor chain in memory — very long sessions should rely on snapshots + tail replay (`loadLatestSnapshot`); see skipped benchmark `benchmark: open stays fast on 10k-event log`.
- `readEventsFile` runs `repairJsonlText` on open when the last JSONL line was truncated (crash mid-append).
