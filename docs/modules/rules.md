# Module: `rules/`

## Purpose

CEL evaluation, dice, rule-function registry, track math primitives, and synchronous pipeline stages (`check`, `adjudicate`, `decide`, custom stages, decay).

## Public API

| Export | Role |
|---|---|
| `createCelEngine()` | `CelEngine` with compile cache; errors include expression text |
| `celCheck(expr)` | Compile-only check; wired into zod `Cel` via `setCelValidator` |
| `adaptCelContext` / `adaptCelResult` | cel-js 8.x numeric bridge (see below) |
| `createRuleEngine(cel)` | Register/sync `RuleFn`; `run` validates drafts and seeds RNG from `rngKey` |
| `buildCelContext(deps, params)` | [CEL context table](../architecture.md#44-cel-context-buildcelcontext) (+ L1 `track_offset` / `tier_shift`) |
| `tierFor`, `marginal`, `decayedCounter`, `computeDelta`, `applyTurnCap`, `decayStep` | [Tracks, tiers, deltas](../architecture.md#42-tracks-tiers-deltas) |
| `parseDice`, `rollDice`, `rollCheck` | [Dice and checks](../spec.md#18-dice-and-checks) |
| `runChecks`, `adjudicate`, `decideIntent`, `runStageRules`, `decayTicks` | Pipeline stages |

`RulesDeps`: `{ state, authored, policy, cel, rules, catalog, celContext }`.

## CEL numeric semantics (cel-js 8.x)

- cel-js uses **bigint** for integer literals and often for integer-valued variables.
- **Context adapter**: JavaScript numbers that are safe integers are passed as `bigint`; fractional values (e.g. `event.intensity`) stay IEEE doubles.
- **Result adapter**: `bigint` results convert back to `number` when within `Number.isSafeInteger`; otherwise `CEL_EVAL`.
- YAML authors can write natural expressions such as `tracks.affinity < 40 && event.intensity > 0.5` without suffixes or casts.

## Extension events (timeline integrator)

`adjudicate` may emit:

- `rule.window_opened` — `{ id, owner, target?, untilScene, durationScenes }`
- `rule.threshold_fired` — `{ id, owner, target? }`

Reducer owner should fold these into `state.windows` / `state.firedThresholds` if not already updated inline.

## Edge cases

- Advantage + disadvantage on checks cancel before rolling.
- d20 advantage/disadvantage: roll twice keep high/low when expression is `1d20` ([Section 18](../spec.md#18-dice-and-checks)).
- `decayTicks(deps, from, to)` uses closed-form hourly decay over the whole span; skips `|Δ| < 0.01`. World invokes it via `kernelRulesDeps` (not via `RuleEngine` methods).
- Zero track deltas are not emitted from `adjudicate`.
- `adjudicate` returns nothing for an event type that has no `delta_table` row, so its windows, thresholds and custom rules are skipped for that type too: give every event type a row (an empty `{}` is fine).
- CEL `scene.*` in `adjudicate` (window triggers, thresholds, custom-rule `when`) describes the turn's scene when the pipeline passes `sceneId` (it always does).
- A custom rule may emit `scene.ended` to close the scene from inside a turn. The rest of that turn still runs against the scene as the turn found it (field resolution, render, commit) and no autonomous exchange follows; hosts then see `Engine.scene.active() === null`.
