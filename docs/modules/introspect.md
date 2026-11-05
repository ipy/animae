# Introspect module

## Purpose
Synchronous read-only views over engine state for TUI/RPC ([Section 15](../spec.md#15-introspection-and-visibility)): path catalogue, visibility policy, temporary grants, and turn `explain`.

## Public API
- `createIntrospect(k: Kernel): Introspect`

### Introspect
| Method | Notes |
|--------|--------|
| `query(viewer, path)` | Returns deep-frozen JSON, or **`undefined` when denied** (never throws). |
| `canRead(viewer, path)` | Visibility + active grants. |
| `grant(viewer, path, ttl?)` | Emits `visibility.granted` with `expiresAt` from world time + duration. |
| `revoke(viewer, path)` | Ends the grants for exactly `(viewer, path)` before their TTL by emitting `visibility.expired`; does nothing (and writes no event) when no such grant is active. |
| `expireGrants()` | Emits `visibility.expired` for elapsed grants (call on `time.advanced`). |
| `explain(turnId, viewer)` | Event chain filtered by viewer/kinds rules; adds synthetic `retrieval` items from `utterance.retrieval` (ids/scores/owner; memory text only when the viewer may read `characters/<owner>/memory`). |
| `registerViewer(v)` | Registers a custom viewer id: policy `visibility.rules` may target that id; optional `extends` inherits another viewer's rules (cycle-safe); optional `filter(path, value)` post-processes query results (`undefined` hides). JSON-RPC blocks this registrar. |

## Paths
Paths are **slash-separated** (`world/vars`, `world/vars/<key>`, `characters/<id>/tracks`). Anything the engine does not
recognise answers `undefined`, exactly like a denied path, so a dotted look-alike such as `world.vars` or `world.location`
fails silently rather than loudly: a host that reads state must use the real paths and test them against a real engine,
not a fake that accepts both spellings. `world/vars/<key>` takes the var key verbatim (`world/vars/res.food` is fine, the
dots belong to the key).

See `contracts.ts` query catalogue. Also supported: `characters/<id>` (summary), `characters/<id>/alias` (runtime nickname, aliases and address labels set via `entity.alias_set`; `characters/<id>/alias/nickname` is the nickname entry only), `characters/<id>/card` (the full authored card with extension fields; **`debug` viewer only**, whatever the policy says), `world/location`, `world/time`, `world/chapter`, `world/fields`, `budget`, `director/*`, `events` (last 200, kind-filtered; includes `narration` when allowed), `runtime/mode` (current mode, pending switch, `switchAt`, `models`), `timeline`.

## Visibility
- Rules evaluated in order; **last match wins**; no match → deny.
- `debug` bypasses all rules.
- Active grants (including TTL) allow before rule evaluation.
- Child paths of `characters/<id>` and `world/locations`: readable when their own rule or the parent's rule allows; a rule that names the child path itself and denies it wins over the parent's allow (an active grant on the child still lifts it).
- `events` path: optional rule `kinds` globs filter returned events and `explain`. Narration events also match visibility paths `events/narration` and, for scene breaks, `events/narration/style:scene_break` ([Section 8](../spec.md#8-cognitive-pipeline)).
- `player` + `world/vars`: only `world.public_vars` and vars allowed by path rules on `world/vars/<key>`.
- `npc:<id>` self-view: L4 field effects via `k.m.fields.resolve` (`suppress_memory_tags`, etc.).

## Memory sync
`characters/<id>/memory` reads `memorySyncList` — async disk load is not performed inside `query`. Integrators should warm cache via `memory.list()` or prior retrieval in the same session. Writes extend a loaded cache instead of dropping it, so `explain` still shows the text of memories retrieved earlier in the session; a cold cache (fresh process, nothing loaded yet) yields ids and scores only.

## Lazy catch-up ([Section 12.6](../spec.md#126-lazy-catch-up))
- `scene.start` and the first turn of a scene call `world.catchUp` for each participant and the scene location (async, full fidelity per policy).
- **`Engine.queryAsync`** (and JSON-RPC `query`): for `viewer: player`, paths `characters/<id>/**` and `world/locations/<id>` trigger `world.catchUp` when `lastSimulated` is behind world time, then return the same payload as `query`.
- **Sync `query()`** does not await catch-up; use `queryAsync` or accept stale `lastSimulated` until the next scene or async query.
- Per-entity `catchUp` applies offscreen fidelity only; global schedule/decay/long-event span work runs on `time.advanced` (see [world module — Offscreen / catch-up](./world.md#offscreen--catch-up)), not inside each `catchUp` call.

## Edge cases
- Denied paths return `undefined` (callers must distinguish from empty arrays).
- `characters` list includes only ids the viewer may read (`characters/<id>` or `characters/<id>/identity`).
- Grant expiry uses absolute world minutes (`worldMinutes`), not calendar day×1440 without `(day-1)` offset.
