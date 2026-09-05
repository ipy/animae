# Introspect module

## Purpose
Synchronous read-only views over engine state for TUI/RPC (§15): path catalogue, visibility policy, temporary grants, and turn `explain`.

## Public API
- `createIntrospect(k: Kernel): Introspect`

### Introspect
| Method | Notes |
|--------|--------|
| `query(viewer, path)` | Returns deep-frozen JSON, or **`undefined` when denied** (never throws). |
| `canRead(viewer, path)` | Visibility + active grants. |
| `grant(viewer, path, ttl?)` | Emits `visibility.granted` with `expiresAt` from world time + duration. |
| `expireGrants()` | Emits `visibility.expired` for elapsed grants (call on `time.advanced`). |
| `explain(turnId, viewer)` | Event chain filtered by viewer/kinds rules. |
| `registerViewer(v)` | Custom viewer defs (reserved for extensions). |

## Paths
See `contracts.ts` query catalogue. Also supported: `characters/<id>` (summary), `world/location`, `world/time`, `world/chapter`, `world/fields`, `budget`, `director/*`, `events` (last 200, kind-filtered), `timeline`.

## Visibility
- Rules evaluated in order; **last match wins**; no match → deny.
- `debug` bypasses all rules.
- Active grants (including TTL) allow before rule evaluation.
- `events` path: optional rule `kinds` globs filter returned events and `explain`.
- `player` + `world/vars`: only `world.public_vars` and vars allowed by path rules on `world/vars/<key>`.
- `npc:<id>` self-view: L4 field effects via `k.m.fields.resolve` (`suppress_memory_tags`, etc.).

## Memory sync
`characters/<id>/memory` reads `memorySyncList` — async disk load is not performed inside `query`. Integrators should warm cache via `memory.list()` or prior retrieval in the same session.

## Lazy catch-up (§12.6)
- `scene.start` and the first turn of a scene call `world.catchUp` for each participant and the scene location (async, full fidelity per policy).
- **`Engine.queryAsync`** (and JSON-RPC `query`): for `viewer: player`, paths `characters/<id>/**` and `world/locations/<id>` trigger `world.catchUp` when `lastSimulated` is behind world time, then return the same payload as `query`.
- **Sync `query()`** does not await catch-up; use `queryAsync` or accept stale `lastSimulated` until the next scene or async query.
- Rule fidelity (schedule, decay, long-event phases) runs inside `world.catchUp` before narrate/full side effects.

## Edge cases
- Denied paths return `undefined` (callers must distinguish from empty arrays).
- `characters` list includes only ids the viewer may read (`characters/<id>` or `characters/<id>/identity`).
- Grant expiry uses absolute world minutes (`worldMinutes`), not calendar day×1440 without `(day-1)` offset.
