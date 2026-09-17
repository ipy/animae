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
Paths are **slash-separated** (`world/vars`, `world/vars/<key>`, `characters/<id>/tracks`). Anything the engine does not
recognise answers `undefined`, exactly like a denied path, so a dotted look-alike such as `world.vars` or `world.location`
fails silently rather than loudly: a host that reads state must use the real paths and test them against a real engine,
not a fake that accepts both spellings. `world/vars/<key>` takes the var key verbatim (`world/vars/res.food` is fine, the
dots belong to the key).

See `contracts.ts` query catalogue. Also supported: `characters/<id>` (summary), `characters/<id>/alias` (runtime nickname, aliases and address labels set via `entity.alias_set`; `characters/<id>/alias/nickname` is the nickname entry only), `characters/<id>/card` (the full authored card with extension fields; **`debug` viewer only**, whatever the policy says), `world/location`, `world/time`, `world/chapter`, `world/fields`, `budget`, `director/*`, `events` (last 200, kind-filtered), `timeline`.

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
