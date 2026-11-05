# World module (`packages/engine/src/world`)

## Purpose

Calendar, time advance, schedule/long events, offscreen lazy catch-up, and world variable / location moves.

## Public API

- `createWorldService(k: Kernel): WorldService & { catchUpAll(): Promise<EngineEvent[]> }`
- Re-exported helpers: `parseDurationMinutes`, calendar helpers, `activeScheduleOffsets`, `fireTimesInRange`, `parseAtTime`.

`WorldService` (see `contracts.ts`): `now`, `advance`, `set`, `move`, `runSchedule`, `catchUp`, `interruptLongEvent`, `chapter`, `format`, `toMinutes`, `fromMinutes`, `parseDuration`.

## Time advance

1. Validates `to >= now` (`AnimaeError("TIME_BACKWARDS")`).
2. Processes `(from, to]` in chronological segments: `decayTicks(deps, segmentFrom, segmentTo)` between milestones, then schedule fires and day-boundary hooks (`runStageRules(..., "daily")`, optional `memory.propagateTick` on `day`), long-event phases, `introspect.expireGrants()`. Decay/daily/schedule interleave at sorted absolute-minute milestones (schedule before daily at the same minute).
3. Appends a single `time.advanced` event. Before that, `director.tick("time_advanced", { asOf })` at span checkpoints (soft window, force window, deadlines, beat scene grid); after `time.advanced`, one final `tick("time_advanced")` at destination time. Director events are persisted by `tick`; world does not re-emit them.

Rules deps for world: `kernelRulesDeps(k)` → `decayTicks` / `runStageRules` (not optional methods on `RuleEngine`).

## Scheduler (`authored.schedule`)

- Supports `at` (WorldTime or `day N [HH:MM]`), `every` (`day HH:MM`, `hour`, `every Nm`, optional `week D HH:MM`).
- `when` CEL guard; `emit` or registered `rule` fn.
- L0 `schedule_offset` from **active** runtime fields shifts fire times (minutes per schedule id).
- Fires write `schedule.fired` then payload events with `source: schedule:<id>`.
- One-shot `at` items use `state.schedule[id].lastFired` / `done` for idempotency; recurring items rely on `lastFired` only (reducer may set `done` — ignored for `every`).

## Long events

Items with `duration` + `phases` emit `longevent.phase` as simulated time crosses phase boundaries. `interruptLongEvent` runs `onInterrupt` rule, emits `longevent.interrupted`.

## Offscreen / catch-up

Fidelity from `policy.offscreen.fidelity` (per location/character override):

| Fidelity | Behavior |
|---|---|
| `none` | No-op |
| `rule` | `offscreen.simulated` only |
| `narrate` | + S2-role stream (`purpose: offscreen`) or rule `offscreen.narrateTemplate`; artifact under `artifacts/_offscreen/<entity>.jsonl` when `router.allow("offscreen_narrate")` |
| `full` | + scheduled encounter artifacts / memory for overlapping `characters`+`location` items |

Always ends with `offscreen.simulated` when fidelity ≠ `none`. `catchUpAll()` runs catch-up for every catalog location and character.

Global decay, schedule, and daily hooks run only inside `world.advance` / `processSpan` (turn end, scene end, explicit advance). `catchUp` does **not** re-run that span — it only applies entity offscreen fidelity so decay is never double-applied when several entities catch up after the same advance.

## World vars & moves

- `set(path, value)` → `world.var_set` with optional `policy.schema.extend.world` validation.
- `move(who, location)` → `world.moved`; location must exist in catalog.

## Edge cases / integrator notes

- Track decay always uses `rules/decay.ts` when policy defines `tracks.*.decay`.
- `expireGrants` runs before `time.advanced`; introspect should compare against the post-advance horizon if TTLs must expire mid-span.
- Schedule rule ctx uses `stage: "tick"`; daily custom rules use `stage: "daily"`.
- Engine should call `catchUp` at scene start and on player introspect queries for involved entities.
