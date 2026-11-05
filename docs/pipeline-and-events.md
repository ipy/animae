# Pipeline and events

Source of truth: `packages/engine/src/events.ts` (kinds + payload interfaces), [turn pipeline](./architecture.md#43-turn-pipeline-per-sceneturn), `pipeline/run-turn.ts`.

## Turn pipeline (`scene.turn`)

Per player/NPC turn inside an active scene:

| Step | Sync model calls | Emits (principal) |
|------|------------------|-------------------|
| 1. Input | — | `turn.started`, `input.received` |
| 2. Appraise | **S1 role** (0 or 1 LLM call) | `appraisal`, `input.classified`; optional `safety.flagged` |
| 3. Apply fields (L0–L1) | — | `field.applied`, `field.rejected` (L1 effects visible to check/adjudicate) |
| 4. Check | — | `check.rolled` (0..n policy checks) |
| 5. Adjudicate | — | `track.delta`, `tier.changed`, `rule.window_opened`, `rule.threshold_fired`, rule-emitted drafts |
| 6. Apply fields (L2+) | — | `field.applied`, `field.rejected` |
| 7. Decide intent | — | `intent.decided` |
| 8. Route | — | `route.decided` (S2 tier / backends / budget entitlement); may `budget.degraded` |
| 9. Render | **S2 role** (0 or 1 LLM call) | streams `TurnChunk` `narration` / `text` / `cue` / `choices` / `reset`; `narration`, `utterance`, `intent.mismatch`, `choice.offered` / `choice.filtered` |
| 10. Commit | — | `memory.written`, director hooks, `turn.ended`, `TurnChunk.done` |

**Default sync budget:** `router.budget.syncCallsPerTurn = 2` (at most one S1 + one S2 LLM call). With runtime mode `rule` or per-role `rule` backend, the corresponding slot makes no call. Escalation picks an **S2 tier** above the default when triggers fire and budget allows ([Section 17](./spec.md#17-routing-budget-s2-tiers-and-caching)). Scene end may add **S1 reflection**, **S2 offscreen narrate**, and **S2 autonomous** dialogue (not counted in the two sync turn slots). Side jobs respect the same degrade flags as sync routing.

**Runtime:** `runtime.mode_changed` and `runtime.fallback_used` are recorded separately from `route.decided` ([Section 22](./spec.md#22-event-type-catalog), [Appendix D](./spec.md#appendix-d-replay-semantics)).

Field L1 effects are resolved after appraise so `event.type` is known for check/adjudicate.

### `TurnChunk` streaming (render step)

Render emits incremental `TurnChunk` values: `text`, `narration`, `cue`, `choices`, `reset`, `done` ([Section 20.1](./spec.md#201-typescript-api)). Text and narration chunks may carry optional `speaker` (text/cue only), `autonomous` (text), **`newUtterance`** (text), and **`newParagraph`** (narration). Narration streams before the speaking character's `text` for the turn.

**Narration fragments:** consecutive `narration` chunks with the same `style` merge into one paragraph unless `newParagraph: true`. A paragraph ends when a different chunk type arrives or `done` is emitted.

**Utterance contract** (shared helper `createUtteranceStreamState` / `applyTextTurnChunk` / `closeUtteranceStream` in `@animae/engine`):

- Consecutive `text` chunks from the **same speaker** between two `done` chunks are **fragments of one utterance** unless `newUtterance: true` on a chunk.
- A **speaker change**, **`newUtterance`**, or **`done`** closes the open utterance.
- Consumers (`@animae/host` `consumeTurnStream`, `@animae/tui` `useTurn`, Web `stream` frames) must append fragments into **one transcript row** and emit **one** stream start / end pair per utterance. Web `stream` `phase=delta` carries the **fragment** (`applied.delta`), not the full accumulated line.
- Timeline replay seeds the first text chunk of each stored utterance with `newUtterance: true` so playback matches live streaming boundaries.

See [spec.md](./spec.md) (TurnChunk type) and [embedding.md](./embedding.md) (host integration).

## Scene lifecycle (extensions)

| Event | Payload highlights |
|-------|-------------------|
| `scene.started` | `{ sceneId, location, participants[], fields[] }` |
| `scene.ended` | `{ sceneId, turns }` |
| `turn.started` / `turn.ended` | turn counters |

## Event catalogue

Kinds are listed in `EVENT_KINDS`. Payload interfaces below; envelopes also carry `id`, `kind`, `source`, `because`, `t` (world time).

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

### Gallery (collection provenance)

| Kind | Payload |
|------|---------|
| `gallery.unlocked` | `{ item, source? }` — first preset unlock only |
| `gallery.captured` | `{ item, rating }` |
| `gallery.rendered` | `{ item, imageId, job }` |
| `gallery.removed` | `{ item }` |

Reducer: no-op for gameplay state; authoritative data lives in `gallery/collection.json`. See [gallery.md](./gallery.md).

### Intent & generation

| Kind | Payload |
|------|---------|
| `intent.decided` | `{ owner, intent, scores{}, forced? }` |
| `intent.mismatch` | render vs decided intent |
| `route.decided` | `{ appraise: { backend, slot?, model? } \| { backend: "rule" }, render: { backend, slot?, tier?, model? } \| { backend: "rule" }, triggers[], escalated?, budget: { s1Calls, s2CallsByTier }, degraded?[] }` — authoritative for replay ([Appendix D](./spec.md#appendix-d-replay-semantics)) |
| `budget.degraded` | `{ action, from?, to?, reason?, kind_detail?, degraded?[] }` — tier ids in `from`/`to`, or `rule` / `skipped` / `deferred` ([Section 17.4](./spec.md#174-degradation)) |
| `narration` | `{ text, style?: "normal" \| "scene_break" }` — no speaker; source `pipeline:render` |
| `utterance` | `{ speaker, text, cues[], addressee?, intent?, autonomous?, recording?, retrieval? }` — optional `retrieval`: `{ kind, id, score, owner }[]` (no body text; for `explain`) |
| `choice.offered` / `choice.taken` / `choice.filtered` | choice flow |

### Memory

| Kind | Payload |
|------|---------|
| `memory.written` | `{ owner, memoryId, kind, importance, src?, path }` |
| `memory.distorted` | `{ owner, memoryId, distortionKind }` |
| `memory.propagated` | `{ from, to, memoryId, newMemoryId, hops }` — shareable gossip one hop per tick |
| `reflection.proposed` / `accepted` / `rejected` | `{ owner, summaries[], goal_changes[], new_claims[] }` on accept |

### Entities & world

| Kind | Payload |
|------|---------|
| `entity.generate` | `{ request: { kind, template, id?, hints?, brief? }, reason? }` — request only; fulfilled live into `entity.created` (reducer no-op) |
| `entity.created` | `{ entity, template?, data{} }` |
| `character.promoted` | `{ id, from, to, data? }` |
| `character.secret_unlocked` | `{ id, secret }` — emitted after adjudication when a locked secret's `unlock` expression holds; the reducer adds `secret` to `characters[id].unlockedSecrets` |
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
| `runtime.mode_changed` | `{ before, after, reason, trigger? }` — backend per role (+ optional `s2Tier`) |
| `runtime.fallback_used` | `{ phase, from: "llm", to: "rule", error }` — one failed LLM call served by rule backend |

Host applications may emit **additional kinds** via rule drafts (e.g. `myapp.pair.formed`); those must be handled by reducers or tolerated as informational.

## Subscriptions (RPC)

`subscribe` with `kinds: ["*"]` or explicit list → server notifications `{ method: "event", params: { kind, event } }`. Turn streaming uses `turn.chunk`.

See [rpc-reference.md](./rpc-reference.md).
