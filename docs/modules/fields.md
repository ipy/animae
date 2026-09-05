# Fields module (`@animae/engine` / `src/fields`)

## Purpose

Resolves **fields** (§10): scoped modifiers at levels L0–L4, grant/revoke at runtime, caps, costs, and a ledger view over `field.*` events.

## Public API

- `createFieldSystem(k: Kernel, opts?: { bypassArmed?: (what: string) => boolean }): FieldSystem`
- Helpers exported for tests/integration: `scopeMatches`, `holderInvolved`, `mergeFieldEffects`, `clampEffects`, `grantAllowed`

### `FieldSystem`

| Method | Role |
|--------|------|
| `resolve(q)` | Collect in-scope fields, merge by level + priority, clamp, return merged effects + `field.applied` drafts |
| `grant(f, why?)` | Policy check → `field.granted` or `field.rejected` + `LedgerEntry` |
| `revoke(id)` | `field.revoked` |
| `declare(f)` | Session-only declared field (same shape as authored; not persisted until granted) |
| `onTurnEnd` / `onSceneEnd` | TTL ticks (`field.age`), `field.cost_due` / settlement |
| `ledger()` | All `field.*` events on the current branch |

Wire `bypassArmed` from `Director.bypassArmed` so exceptions can bypass `field_cap` and `cost_due`.

## Holder involvement

A field applies only when its **holder** is involved in the scene (after scope filters):

| Holder kind | Involved when |
|-------------|----------------|
| `character` | `holder.ref` is a scene participant |
| `location` | `holder.ref` equals scene location (or player location with no scene) |
| `item` | Item is held by a participant (`item.moved` / initial state) |
| `time`, `world`, `external` | Always (global modifiers) |

## Scope

- `scene`, `location`, `turns` (TTL while active), `time` window, `when` (CEL; `scope.characters` exposed on CEL context)
- Sources: authored catalog, `declare()`, and active entries in `EngineState.fields` (runtime / rule / anchor / beat grants)

## Merge (§10.4)

Per level: sort by `priority` desc, then fold each top-level effect key using that field’s `stacking`:

- `add` — numbers sum; arrays union; objects deep-merge with add on leaves
- `max` — numeric max; arrays union; objects deep-merge with max on leaves
- `override` — higher priority (earlier in sorted list) wins the whole key
- `resolver:<fn>` — `rules.run(fn)` with `vars.field_merge_values`; optional draft `{ kind: "field.resolver", merged }`; numeric object leaves resolved per key

L4 merged effects are returned only for the query `owner` (self-view); they must not mutate stored world state.

## Caps & grants

- `policy.fields.caps` — clamp magnitudes (`salience.boost`, `event_prob`, `track_offset`, `track_mult`, `intent_bias`); report keys on `field.applied.clamped`
- Bypass when `bypassArmed("field_cap")`
- `policy.fields.grants` — CEL on `{ holder, source }`; load-time violations are policy loader errors; runtime denial → `field.rejected`

## Costs

Optional `cost` on a field: `due` CEL (default: scope no longer matches at scene end), `ttlScenes`, payer, `effects` / `events`, `fallback`. Emits `field.cost_due` then `field.cost_settled` (`paid` | `fallback` | `bypassed`).

## Edge cases

- Identical `field.applied` payloads for the same field/turn/owner are deduped within a turn.
- Author `source: "author"` fields do not require a runtime grant when in scope.
- Beat-granted fields use `source: "runtime"` with grant `why.source: "beat"`.
