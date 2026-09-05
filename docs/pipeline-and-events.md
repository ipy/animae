# Pipeline and events

Source of truth: `packages/engine/src/events.ts` (kinds + payload interfaces), `architecture.md` §4.3, `pipeline/run-turn.ts`.

## Turn pipeline (`scene.turn`)

Per player/NPC turn inside an active scene:

| Step | Sync LLM? | Emits (principal) |
|------|-----------|-------------------|
| 1. Input | — | `turn.started`, `input.received` |
| 2. Appraise | **S1 #1** | `appraisal`, `input.classified`; optional `safety.flagged` |
| 3. Check | — | `check.rolled` (0..n policy checks) |
| 4. Adjudicate | — | `track.delta`, `tier.changed`, `rule.window_opened`, `rule.threshold_fired`, rule-emitted drafts |
| 5. Apply fields | — | `field.applied`, `field.rejected` |
| 6. Decide intent | — | `intent.decided` |
| 7. Route | — | `route.decided`; may `budget.degraded` |
| 8. Render | **S1 or S2 #2** | streams `TurnChunk` text/cue; `utterance`, `intent.mismatch`, `choice.offered` / `choice.filtered` |
| 9. Commit | — | `memory.written`, director hooks, `turn.ended`, `TurnChunk.done` |

**Default sync budget:** `router.budget.syncCallsPerTurn = 2` (appraise + render). S2 routing is optional per turn (`s2PerTurn`, triggers, scene pool). Scene end may add **S2 reflection** (not counted in the two sync turn slots) and offscreen narrate when fidelity demands.

Field L1 effects are resolved after appraise so `event.type` is known for check/adjudicate.

## Scene lifecycle (extensions)

| Event | Payload highlights |
|-------|-------------------|
| `scene.started` | `{ sceneId, location, participants[], fields[] }` |
| `scene.ended` | `{ sceneId, turns }` |
| `turn.started` / `turn.ended` | turn counters |

## Event catalogue

Kinds are listed in `EVENT_KINDS`. Payload interfaces below; envelopes also carry `id`, `kind`, `source`, `because`, `at` (world time).

### Input & appraisal

| Kind | Payload |
|------|---------|
| `input.received` | `{ actor, addressee?, text, choiceId? }` |
| `input.classified` | classification metadata |
| `appraisal` | `{ actor, addressee, appraisal: Appraisal }` — see `events.ts` `Appraisal` |
| `safety.flagged` | safety classifier output |

### Checks & rules

| Kind | Payload |
|------|---------|
| `check.rolled` | `{ id, expr, rolls[], kept?, modifier, total, dc, success, margin, advantage?, disadvantage?, skill?, actor?, target? }` |
| `rule.window_opened` | `{ id, owner, target?, untilScene, durationScenes }` |
| `rule.threshold_fired` | `{ id, owner, target? }` |

### Tracks

| Kind | Payload |
|------|---------|
| `track.delta` | `{ owner, target?, track, delta, before, after, eventType?, factors?, clamped?, reason? }` |
| `tier.changed` | `{ owner, target?, track, from, to, direction }` |

### Fields

| Kind | Payload |
|------|---------|
| `field.applied` | `{ field, level, holder, effects, clamped?, owner? }` |
| `field.rejected` | rejection reason |
| `field.cost_due` / `field.cost_settled` | cost ledger |
| `field.granted` | `{ field: FieldDef }` |
| `field.revoked` | `{ field: string }` |
| `field.age` | `{ field, scenes?, turns? }` |
| `info_arrival` | `{ tags?, claim?, knowledge?, text? }` — anchor / knowledge injection |

### Intent & generation

| Kind | Payload |
|------|---------|
| `intent.decided` | `{ owner, intent, scores{}, forced? }` |
| `intent.mismatch` | render vs decided intent |
| `route.decided` | `{ tier: s1\|s2, reasons[], degraded? }` |
| `budget.degraded` | `{ degraded?, action?, kind_detail? }` |
| `utterance` | `{ speaker, text, cues[], addressee?, intent?, autonomous? }` |
| `choice.offered` / `choice.taken` / `choice.filtered` | choice flow |

### Memory

| Kind | Payload |
|------|---------|
| `memory.written` | `{ owner, memoryId, kind, importance, src?, path }` |
| `memory.distorted` / `memory.propagated` | forgetting pipeline |
| `reflection.proposed` / `accepted` / `rejected` | `{ owner, summaries[], goal_changes[], new_claims[] }` on accept |

### Entities & world

| Kind | Payload |
|------|---------|
| `entity.created` | `{ entity, template?, data{} }` |
| `character.promoted` | `{ id, from, to, data? }` |
| `world.var_set` | `{ path, value, previous? }` |
| `time.advanced` | `{ from, to, minutes, reason? }` |
| `world.moved` | `{ who, from?, to }` |
| `item.moved` | `{ item, to: EntityRef \| null }` |
| `character.var_set` | `{ id, key, value }` |
| `schedule.fired` | `{ id, at: WorldTime }` |
| `longevent.phase` / `longevent.interrupted` | scheduled multi-phase events |
| `offscreen.simulated` | `{ entity, from, to, fidelity }` |

### Director

| Kind | Payload |
|------|---------|
| `anchor.progress` | `{ anchor, stage: soft\|hard\|force, detail? }` |
| `anchor.fulfilled` / `anchor.fallback` | `{ anchor }` |
| `beat.entered` / `beat.exited` | `{ beat }` |
| `sidenote.added` | `{ npc, text, ttlTurns, verbatim, noteId }` |
| `sidenote.expired` / `sidenote.echoed` | sidenote lifecycle |
| `exception.used` | `{ exceptionId, target, periodKey }` |

### Visibility & timeline

| Kind | Payload |
|------|---------|
| `visibility.granted` / `visibility.expired` | `{ viewer, path, expiresAt? }` |
| `branch.header` / `branch.forked` | branch metadata |
| `carry.applied` / `purge.applied` | rewind/carry |
| `config.reloaded` / `config.warning` / `config.error` | hot reload |

Games may emit **additional kinds** via rule drafts (e.g. example-game `example-game.pair.formed`); those must be handled by reducers or tolerated as informational.

## Subscriptions (RPC)

`subscribe` with `kinds: ["*"]` or explicit list → server notifications `{ method: "event", params: { kind, event } }`. Turn streaming uses `turn.chunk`.

See [rpc-reference.md](./rpc-reference.md).
