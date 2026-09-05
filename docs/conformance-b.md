# Spec conformance audit — Team B (§7–12, §17–18)

Audit date: 2026-10-30. Scope: rules/expressions, cognitive pipeline, memory, fields, director, world/time, router/cache, dice/checks.

Legend: **pass** = normative behavior covered by code + test; **fix** = gap closed in this audit; **deviation** = intentional or documented difference.

## Summary of fixes (this audit)

| Issue | Fix |
|-------|-----|
| §12.6 query-triggered lazy catch-up missing | `preflightPlayerCatchUp`, `Engine.queryAsync`, RPC `query` awaits catch-up; path `world/locations/<id>` added |
| §12.5 `rule` fidelity did not run schedule/decay on `world.catchUp` | `world.catchUp` calls `processSpan` before narrate/full drafts |
| No automated check for 2 sync LLM calls/turn | `test/conformance/conformance-b.test.ts` |

---

## §7 Rules & expressions

| Spec statement | Code | Test | Status |
|----------------|------|------|--------|
| YAML conditions use CEL | `rules/cel.ts`, policy loader | `rules/cel.test.ts` | pass |
| TS rules via `register(name, fn)` | `rules/rule-engine.ts` | preset-base bundle | pass |
| CEL ctx: `self, other, actor, event, scene, world, time, tracks, tiers, memory, fields, check` | `rules/cel-context.ts` | `conformance-b.test.ts` §7.2 | pass |
| `delta_formula` = base × intensity × sincerityFactor × traitMult × marginal(n) × trackMult | `rules/primitives.ts` `computeDelta`, `adjudicate.ts` | `rules/primitives.test.ts`, `preset-base/test/rules.test.ts` | pass |
| `sincerityFactor` only for positive base | `computeDelta`, `adjudicate.ts` | `preset-base/test/rules.test.ts` | pass |
| `marginal` with halfLife decay on n | `decayedCounter`, `marginal` | `preset-base/test/rules.test.ts`, `rules/primitives.test.ts` | pass |
| `turn_cap` | `applyTurnCap` | `preset-base/test/rules.test.ts`, `rules/primitives.test.ts` | pass |
| `window` mult / capToLoss | `adjudicate.ts` | reducer + adjudicate paths | pass |
| `threshold` emit | `rules/stages.ts` / rule engine | policy tests | pass |
| `tier` + hysteresis | `tierFor` | `rules/primitives.test.ts`, `preset-base/test/rules.test.ts` | pass |
| Policy load order / invalid reject | `policy/load.ts` | `policy/load.test.ts` | pass |

---

## §8 Cognitive pipeline

| Spec statement | Code | Test | Status |
|----------------|------|------|--------|
| Stage order classify→…→commit | `pipeline/run-turn.ts` | `rules/pipeline.test.ts`, e2e | pass |
| **2 sync LLM calls/turn** (appraise + render) | `appraise.ts`, `render.ts` | `conformance-b.test.ts` §8 | pass |
| Appraise schema + input_class | `pipeline/schemas.ts`, `appraise.ts` | `pipeline/appraise.test.ts` | pass |
| Render schema text/cues/intent_realized/choices | `render.ts` | `pipeline/render.test.ts` | pass |
| `intent.mismatch` + retryOnMismatch 0/1 | `render.ts` | `pipeline/render.test.ts` | pass |
| Choice filter → `choice.filtered` | `render.ts` | `pipeline/render.test.ts` | pass |
| Output language identity → world | `pipeline/prompt.ts` `outputLanguage` | `pipeline/prompt.test.ts` | pass |
| S2 tools search/read ≤3 steps | `render.ts`, `model/adapter.ts` | `pipeline/render.test.ts` | pass |

---

## §9 Memory & knowledge

| Spec statement | Code | Test | Status |
|----------------|------|------|--------|
| Scoring 0.5/0.2/0.2/0.1, recency HL 7d, K=8 | `memory/retrieval.ts`, policy defaults | `memory/memory.test.ts`, `conformance-b.test.ts` | pass |
| Vector weight 0.3 rescale | `scoreMemoryEntry` | `memory/memory.test.ts` | pass |
| Forgetting retention formula | `memory/util.ts` | `memory/memory.test.ts` | pass |
| Distortion at retrieval only | `memory/distortion.ts`, `service.ts` | `memory/memory.test.ts` | pass |
| Propagation per hop | `memory/service.ts` | `memory/memory.test.ts` | pass |
| Reflection default accept (taboo/bottom_line tags) | `memory/reflection.ts` | `memory/memory.test.ts` | pass |
| on-demand index cap 50 | `memory/knowledge.ts` | `memory/memory.test.ts` | pass |

---

## §10 Fields

| Spec statement | Code | Test | Status |
|----------------|------|------|--------|
| L0–L4 effect keys | `fields/levels.ts`, merge | `fields/field-system.test.ts` | pass |
| Grants / reject over max | `fields/grants.ts` | `fields/field-system.test.ts` | pass |
| Caps → `clamped` on `field.applied` | `fields/caps.ts` | `fields/field-system.test.ts` | pass |
| L4 npc self-view only | `fields/field-system.ts`, `introspect/query.ts` | `fields/field-system.test.ts`, `introspect.test.ts` | pass |
| Ledger events | `fields/field-system.ts` | `fields/field-system.test.ts` | pass |

---

## §11 Director

| Spec statement | Code | Test | Status |
|----------------|------|------|--------|
| Anchors soft/hard/force timing | `director/anchors.ts` | `director/director.test.ts` | pass |
| Single active beat | `director/beats.ts` | `director/director.test.ts` | pass |
| Sidenote 8-char echo | `director/sidenotes.ts` | `director/director.test.ts` | pass |
| Exceptions charges/period/bypass | `director/exceptions.ts` | `director/director.test.ts` | pass |

---

## §12 World & time

| Spec statement | Code | Test | Status |
|----------------|------|------|--------|
| Calendar / WorldTime | `world/calendar.ts` | `world/calendar.test.ts` | pass |
| Scheduler → `schedule.fired` | `world/schedule-run.ts` | `world/schedule.test.ts` | pass |
| Long event phases / interrupt | `world/longevent.ts` | `world/longevent.test.ts` | pass |
| Offscreen fidelity none/rule/narrate/full | `world/offscreen.ts` | `world/offscreen.test.ts` | pass |
| `skip_offscreen_narrate` degrade | `router/router.ts`, offscreen | `world/offscreen.test.ts`, `router/router.test.ts` | pass |
| Lazy catch-up scene start | `run-turn.ts`, `scene-service.ts` | e2e, offscreen tests | pass |
| Lazy catch-up **player query** | `introspect/query-catchup.ts`, `queryAsync` | `conformance-b.test.ts` | **fix** |
| Rule fidelity on catchUp (schedule/decay) | `world/service.ts` `catchUp` + `processSpan` | offscreen + conformance | **fix** |

---

## §17 Router, budget, cache

| Spec statement | Code | Test | Status |
|----------------|------|------|--------|
| Upgrade triggers | `router/triggers.ts` | `router/router.test.ts` | pass |
| Budget s2PerTurn / pool / ratio | `router/budget.ts` | `router/router.test.ts` | pass |
| Degrade order + `budget.degraded` | `router/budget.ts`, `router.ts` | `router/router.test.ts` | pass |
| Prompt static / semi-static / dynamic | `pipeline/prompt.ts` | `pipeline/prompt.test.ts` | pass |
| 2 cache breakpoints (Anthropic) | `model/messages.ts` | `model/model.test.ts` | pass |
| `syncCallsPerTurn: 2` in policy | `schema/policy.ts`, defaults | policy fixtures | pass |

---

## §18 Dice & checks

| Spec statement | Code | Test | Status |
|----------------|------|------|--------|
| Grammar `NdM[kh\|klK][±C]` | `rules/dice.ts` | `rules/dice.test.ts` | pass |
| Advantage/disadvantage cancel | `rollDice` | `rules/dice.test.ts` | pass |
| `check.rolled` + CEL `check.success/total/margin` | `rules/checks.ts`, `cel-context.ts` | `rules/dice.test.ts`, conformance §7.2 | pass |

---

## Deliberate deviations

| Topic | Notes |
|-------|--------|
| Sync `Engine.query()` vs §12.6 | Plain `query()` does not await LLM narrate during catch-up; **`queryAsync`** and JSON-RPC `query` do. Documented in `docs/modules/introspect.md`. |
| `syncCallsPerTurn` | Policy documents the invariant; runtime does not hard-fail a third sync call—tests assert appraise+render labels only. |
| CEL `fields` in context | Exposes `active` list plus per-id booleans for active field ids (expression-friendly), not full field defs. |
| Default memory weights | Loader adds `vector: 0.3` for embedding rescale (§9.3); lexical weights remain 0.5/0.2/0.2/0.1 when embedding off. |

---

## Test entry points

- Full engine: `bun test animae/packages/engine`
- Team B conformance: `bun test animae/packages/engine/test/conformance/conformance-b.test.ts`
