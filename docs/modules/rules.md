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
| `buildCelContext(deps, params)` | architecture.md §4.4 table (+ L1 `track_offset` / `tier_shift`) |
| `tierFor`, `marginal`, `decayedCounter`, `computeDelta`, `applyTurnCap`, `decayStep` | §4.2 primitives |
| `parseDice`, `rollDice`, `rollCheck` | §18 dice |
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
- d20 advantage/disadvantage: roll twice keep high/low when expression is `1d20` (§18).
- `decayTicks(deps, from, to)` uses closed-form hourly decay over the whole span; skips `|Δ| < 0.01`. World invokes it via `kernelRulesDeps` (not via `RuleEngine` methods).
- Zero track deltas are not emitted from `adjudicate`.
