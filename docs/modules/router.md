# Router

## Purpose

S2 **tier** selection (not S1-vs-S2 render), escalation triggers, sync and side-job budget enforcement, and degradation ([Section 17](../spec.md#17-routing-budget-s2-tiers-and-caching)). Render is always the S2 role (LLM tier or rule backend).

## Public API

```ts
createRouter(k: Kernel): Router

detectContradiction(k: Kernel, owner: CharacterId, claims: { s: string; p: string; o: string }[]): boolean

evaluateTriggers(input: RouteInput, policy: ResolvedPolicy): string[]
isAmbiguous(appraisal: Appraisal, policy: ResolvedPolicy): boolean
```

`Router.plan({ turn, mode })` → `{ mode: RuntimeMode, events, degraded }` — applies `s1PerTurn` / `s2PerTurn` / `syncCallsPerTurn` caps before the turn runs; may emit `budget.degraded` with `kind_detail: "plan"`.

`Router.decide(RouteInput)` → `{ decision: RouteDecision; events: EventDraft[] }` including `route.decided` and any `budget.degraded` drafts (`kind_detail: "route"` or `"side_job"`).

`Router.allow(job)` → `{ ok: boolean; events: EventDraft[]; tier?: string }` for `reflection` | `offscreen_narrate` | `autonomous`.

## `route.decided`

Written before render. Shape ([Section 22](../spec.md#22-event-type-catalog)):

- `appraise`: `{ backend: "llm", slot: "s1", model }` or `{ backend: "rule" }`
- `render`: `{ backend: "llm", slot: "s2", tier, model }` or `{ backend: "rule" }`
- `triggers`: escalation reason ids (empty when none fired)
- `escalated?`: render runs on `models.s2.routing.escalate_to` tier
- `budget`: `{ s1Calls: 0|1, s2CallsByTier: { [tier]: 0|1 } }`
- `degraded?`: action names taken for this turn, in order: the per-turn caps of `plan` first (`RouteInput.planned`), then the escalation budget of `decide`

Authoritative for replay ([Appendix D](../spec.md#appendix-d-replay-semantics)). A later `runtime.fallback_used` for the same turn means replay recomputes that phase on the rule backend instead of loading a recording.

## Triggers (enabled via `policy.router.triggers`)

| Reason | Condition (from `RouteInput` / appraisal) |
|--------|-------------------------------------------|
| `anchor_near` | `anchorNear` |
| `secret_topic` | `secretTopic` (caller: appraisal tags ∩ addressee's **locked** secret tags from `secrets.yaml`, plus literal tag `secret`) |
| `mood_spike` | On policy `mood_spike.track` (default `mood`): `\|Δtrack\| ≥ a` or `\|track value\| ≥ b` (`RouteInput.spikeTrackDelta` / `spikeTrackValue`) |
| `tier_change` | `tierChanged` |
| `contradiction` | `contradiction` (`detectContradiction`) |
| `ambiguity` | type `other`; or positive type + sincerity `< 0.3`; or `injection_suspect` + type ≠ `insincere_speech` |
| `field_high` | `fieldMaxLevel ≥ 2` |
| `sidenote` | `sidenoteReceived` |
| `scene_first` | `sceneFirstTurn` |

Any non-empty `triggers` ⇒ attempt upgrade from the base render tier to `models.s2.routing.escalate_to` when configured and budget allows. Triggers are evaluated on appraisal data the rule backend produces too; rule-only renders record triggers but never set `escalated`.

## Budget

- Per turn: `s1PerTurn`, `s2PerTurn` / `s2PerTurnByTier`, and `syncCallsPerTurn` (see [policy-reference](../policy-reference.md#routerbudget))
- Global ratio: escalated renders / turns > `s2Ratio`
- Per scene pool: `sceneS2Pool` or `ceil(participants × 4 × s2Ratio)`
- Anchor reserve: `s2ReservedForAnchors × pool` slots only for `anchor_near` escalations; other triggers use `pool − reserve`

Degrade order from `policy.router.degrade` (runtime default when empty: `s2_tier_down`, `s2_to_rule`, `s1_to_rule`, `defer_reflection`, `skip_offscreen_narrate`, `skip_autonomous`). Actions:

| Action | Effect |
|--------|--------|
| `s2_tier_down` | Serve render (or side job) from the next lower S2 tier |
| `s2_to_rule` | Serve S2 role on rule backend |
| `s1_to_rule` | Serve appraise on rule backend |
| `defer_reflection` | Skip LLM reflection this scene segment |
| `skip_offscreen_narrate` / `skip_autonomous` | Skip S2 side jobs |

`budget.degraded` payload: `{ action, from?, to?, reason?, kind_detail? }` — tier ids, or `rule`, `skipped`, `deferred`.

Side jobs consult degrade flags set during `decide` when escalation is unaffordable.
