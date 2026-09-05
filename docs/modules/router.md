# Router

## Purpose

S1/S2 escalation, budget enforcement, and side-job gating (§17).

## Public API

```ts
createRouter(k: Kernel): Router

detectContradiction(k: Kernel, owner: CharacterId, claims: { s: string; p: string; o: string }[]): boolean

evaluateTriggers(input: RouteInput, policy: ResolvedPolicy): string[]
isAmbiguous(appraisal: Appraisal, policy: ResolvedPolicy): boolean
```

`Router.decide(RouteInput)` → `{ decision: RouteDecision; events: EventDraft[] }` including `route.decided` and any `budget.degraded` drafts.

`Router.allow(job)` → `{ ok: boolean; events: EventDraft[] }` for `reflection` | `offscreen_narrate` | `autonomous`.

## Triggers (enabled via `policy.router.triggers`)

| Reason | Condition (from `RouteInput` / appraisal) |
|--------|-------------------------------------------|
| `anchor_near` | `anchorNear` |
| `secret_topic` | `secretTopic` (caller: appraisal tags ∩ locked secret tags) |
| `mood_spike` | `\|Δmood\| ≥ a` or `\|mood\| ≥ b` |
| `tier_change` | `tierChanged` |
| `contradiction` | `contradiction` (`detectContradiction`) |
| `ambiguity` | type `other`; or positive type + sincerity `< 0.3`; or `injection_suspect` + type ≠ `insincere_speech` |
| `field_high` | `fieldMaxLevel ≥ 2` |
| `sidenote` | `sidenoteReceived` |
| `scene_first` | `sceneFirstTurn` |

Any reason ⇒ want S2; empty reasons ⇒ S1.

## Budget

- Per turn: `s2PerTurn`
- Global ratio: `s2Turns / turns > s2Ratio`
- Per scene pool: `sceneS2Pool` or `ceil(participants × 4 × s2Ratio)`
- Anchor reserve: `s2ReservedForAnchors × pool` slots only for `anchor_near` escalations; other triggers use `pool − reserve`

Degrade order from `policy.router.degrade` (default `s2_to_s1`, `defer_reflection`, `skip_offscreen_narrate`, `skip_autonomous`). `s2_to_s1` applies only when escalation was **not** anchor-driven. Side jobs consult the same degrade flags set during `decide`.
