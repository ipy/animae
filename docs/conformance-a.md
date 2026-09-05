# Conformance audit A (§3, §4, §5, §6, §13, §22)

Auditor scope: invariants I1–I8 (partial), data root layout, character import/export, timeline capabilities, event catalogue.  
Status legend: **pass** | **pass (fix)** | **deviation** | **partial**

## §3 Engine invariants

| Spec | Code | Test | Status |
|---|---|---|---|
| I1 No gameplay in engine core; policy/preset inject | `policy/load.ts`, `pipeline/*`, `rules/*` | `policy/load.test.ts`, `rules/pipeline.test.ts` | **pass** |
| I2 State changes append-only; replay rebuilds state | `timeline/reducer.ts`, `timeline/snapshots.ts`, `timeline/timeline-store.ts` | `timeline/reducer-audit.test.ts`, `conformance/section-a.test.ts` (random `world.var_set` property + mixed seq) | **pass (fix)** — property test added |
| I3 LLM output is proposal; adjudicator writes events | `pipeline/appraise.ts`, `rules/adjudicate.ts`, `pipeline/run-turn.ts` | `rules/pipeline.test.ts`, `pipeline/appraise.test.ts` | **pass** |
| I4 Every event has `source` and `because` | `timeline/event-log.ts` (`draftToEnvelope`), `pipeline/run-turn.ts` (causal chain), emitters set `source` | `conformance/section-a.test.ts` (envelope fields on reload) | **pass (fix)** — pipeline now sets `because` (e.g. `track.delta` → appraisal id); `choice.taken` on `choiceId` |
| I5 Query filtered by visibility | `introspect/service.ts`, `introspect/visibility.ts` | `introspect/introspect.test.ts` | **pass** |
| I6 Same seed + recordings → byte-identical replay | `timeline/rng.ts`, `model/recording.ts`, `rules/rule-engine.ts` (timeline seed in `ctx.rng`) | `model/model.test.ts`, `conformance/section-a.test.ts`, `e2e/engine.e2e.test.ts` (replay chunks) | **pass (fix)** — rule `rng` no longer hard-coded seed `0`; import branch name content-derived |
| I7 Rule fns sync/pure; ctx frozen; stage IO via ports | `rules/rule-engine.ts` (`Object.freeze`), `model/withRecording` on `ModelPort` | `conformance/section-a.test.ts` (rng determinism) | **pass** |
| I8 Single writer `.animae.lock` (pid) | `store/fs.ts`, `store/memory.ts`, `engine/create-engine.ts` | `store/storage.test.ts`, `conformance/section-a.test.ts`, `e2e/engine.e2e.test.ts` | **pass** |

### I6 wall-clock / random audit (`packages/engine/src`)

| Location | Use | Justification |
|---|---|---|
| `create-engine.ts` `sessionId()` | `Date.now` when `sessionId` omitted | **deviation** — live runs only; tests/e2e pass explicit `sessionId` for reproducibility |
| `timeline-store.ts` `save()` default label | `Date.now` | **deviation** — save slot metadata only; does not affect reducer/replay |
| `store/memory.ts` `mtimeMs` | `Date.now` | **deviation** — in-memory test store metadata; not on replay path |
| `export-import.ts` export filename | `deps.now()` / ISO timestamp | **deviation** — path only; manifest + payload hashes are content-based |
| `Math.random` | *(none in `src/`)* | **pass** |

## §4 Architecture modules

| Module (spec) | Package path | Status |
|---|---|---|
| schema | `packages/engine/src/schema/` | **pass** |
| store | `packages/engine/src/store/` | **pass** |
| timeline | `packages/engine/src/timeline/` | **pass** |
| rules | `packages/engine/src/rules/` | **pass** |
| adjudicator | `rules/adjudicate.ts` (+ pipeline wiring) | **pass** |
| pipeline | `packages/engine/src/pipeline/` | **pass** |
| characters | `packages/engine/src/entities/` + `authored/` | **pass** |
| memory | `packages/engine/src/memory/` | **pass** |
| fields | `packages/engine/src/fields/` | **pass** |
| director | `packages/engine/src/director/` | **pass** |
| world | `packages/engine/src/world/` | **pass** |
| scene | `packages/engine/src/scene/` | **pass** |
| introspect | `packages/engine/src/introspect/` | **pass** |
| classify | `pipeline/appraise.ts` (input_class / safety) | **pass** |
| router | `packages/engine/src/router/` | **pass** |
| dice | `rules/dice.ts` | **pass** |
| model | `packages/engine/src/model/` | **pass** |
| policy | `packages/engine/src/policy/` | **pass** |
| rpc / cli | `packages/engine/src/rpc/`, `packages/cli/` | **pass** |

## §5 Data root layout & rules

| Spec | Code | Test | Status |
|---|---|---|---|
| Paths: `animae.yaml`, `world/**`, `characters/**`, `templates/**`, `policies/**` | `authored/load.ts` | `authored/load.test.ts` | **pass** |
| `timelines/<branch>/events.jsonl` + first line `branch.header` | `timeline/event-log.ts`, `timeline/paths.ts` | `timeline/timeline.test.ts` | **pass** |
| `snapshots/<eventId>.json` | `timeline/snapshots.ts`, `timeline/paths.ts` | `timeline/timeline.test.ts` (every 200 events) | **pass** |
| Snapshot on `scene.end` | `scene/scene-service.ts` → `maybeSnapshot("scene_end")` | `conformance/section-a.test.ts` | **pass** |
| `entities/`, `artifacts/`, `recordings.jsonl` | `timeline/paths.ts`, `timeline/timeline-store.ts` | `timeline/timeline.test.ts`, carry tests | **pass** |
| `saves.yaml` | `timeline/paths.ts` `SAVES_FILE` | `timeline/timeline.test.ts` | **pass** |
| `derived/` | CLI `init` creates dir; no writer yet | — | **partial** — layout only |
| `.animae.lock` | `store/fs.ts`, `paths.ts` `LOCK_FILE` | `conformance/section-a.test.ts` | **pass** |
| Author vs branch file rules | `timeline/artifacts.ts` (COW), `carry.ts` | `timeline/timeline.test.ts`, `carry-memory.test.ts` | **pass** |
| Event line envelope fields | `timeline/event-log.ts` | `conformance/section-a.test.ts` | **pass** |
| CLI init scaffolds §5 tree | `packages/cli/src/commands/init.ts` | — | **pass (fix)** — adds `derived/`, `saves.yaml`, `timelines/main/*` |

**Deliberate deviations**

- `timelines/HEAD` — current branch pointer (not listed in §5 diagram); required for multi-branch UX.
- `exports/` — `.asave.jsonl` export output directory (spec names format, not folder).

## §6 Character system

| Spec | Code | Test | Status |
|---|---|---|---|
| 6.1 Identity / constraints / traits / tracks / goals / secrets / relations / LOD | `schema/authored.ts`, `authored/load.ts` | `authored/load.test.ts` | **pass** |
| 6.2 LOD persistence & promotion | `entities/service.ts`, `memory/service.ts` | `entities/entities.test.ts`, `memory/memory.test.ts` | **pass** |
| 6.3 Dynamic generation | `entities/service.ts`, `entities/adjudicate.ts` | `entities/entities.test.ts` | **pass** |
| 6.4 Import ST V2/V3 JSON/PNG | `entities/import-card.ts`, `entities/png-chunks.ts` | `entities/entities.test.ts` | **pass** |
| 6.4 Export `.acard.jsonl` | `entities/acard.ts` | `entities/entities.test.ts` | **pass** |

### §6.4 field mapping (import)

| Source (ST) | Target | Code |
|---|---|---|
| `name` | `identity.name` | `import-card.ts` frontmatter |
| `description` + `personality` | `card.md` body | joined persona |
| `scenario` | `knowledge/scenario.md` (`inject: always`) | `scenarioFm.inject` |
| `first_mes` | `identity.greeting` | frontmatter |
| `mes_example` | `identity.style_examples` | `splitMesExample` |
| `character_book.entries[]` | `knowledge/<n>.md` | `when` from `keys`, `constant` → `inject: always` |
| other fields | `card.md` frontmatter `x_import` | `xImport` loop |

## §13 Timeline

| Capability | Code | Test | Status |
|---|---|---|---|
| `save` → `saves.yaml` | `timeline/timeline-store.ts` | `timeline/timeline.test.ts` | **pass** |
| `load` (snapshot + replay + recordings) | `timeline-store.ts` `reloadEventsAndState` | `timeline/timeline.test.ts`, e2e | **pass** |
| `rewind` / `branch.header` / `branch.forked` | `timeline-store.ts` | `timeline/timeline.test.ts` | **pass** |
| `branches` / `switch` / `diff` | `timeline-store.ts`, `timeline/diff.ts` | e2e save/load/rewind/diff | **pass** |
| `carry` | `timeline/carry.ts` | `carry-memory.test.ts` | **pass** |
| `prune` | `timeline-store.ts` | `timeline/timeline.test.ts` | **pass** |
| `purge` | `timeline/purge.ts` | — | **partial** — covered indirectly; dedicated test TBD |
| `export` manifest `{engine, preset, branch, chain[], hashes}` | `timeline/export-import.ts` | `conformance/section-a.test.ts` | **pass** |
| `import` hash verify + new branch | `export-import.ts` | `timeline/timeline.test.ts`, `conformance/section-a.test.ts` | **pass (fix)** |
| `replay` → `TurnChunk` | `timeline/replay.ts` | `timeline/timeline.test.ts`, e2e | **pass** |
| `recordings.jsonl` | `timeline/recordings.ts` | `timeline/timeline.test.ts`, `model/model.test.ts` | **pass** |
| Hot reload | `engine/hot-reload.ts` | `e2e/engine.e2e.test.ts` | **pass** |

## §22 Event catalogue

All **spec §22** kinds are listed in `packages/engine/src/events.ts` (`EVENT_KINDS`). Emitters:

| Event | Emitter (primary) | Test touchpoint |
|---|---|---|
| `input.received` | `pipeline/run-turn.ts` | e2e, scene tests |
| `input.classified` | `pipeline/appraise.ts` | appraise tests |
| `appraisal` | `pipeline/appraise.ts` | appraise tests |
| `safety.flagged` | `pipeline/appraise.ts` | policy-gated |
| `check.rolled` | `rules/checks.ts` | rules/pipeline |
| `track.delta`, `tier.changed` | `rules/adjudicate.ts` | `rules/pipeline.test.ts` |
| `field.applied`, `field.rejected`, `field.cost_*` | `fields/field-system.ts` | `fields/field-system.test.ts` |
| `intent.decided` | `rules/decide.ts` / pipeline | `rules/pipeline.test.ts` |
| `intent.mismatch` | `pipeline/render.ts` | render tests |
| `route.decided` | `router/router.ts` | router tests |
| `utterance` | `pipeline/run-turn.ts` | e2e |
| `choice.offered`, `choice.filtered` | `pipeline/render.ts` | render tests |
| `choice.taken` | `pipeline/run-turn.ts` when `choiceId` set | **pass (fix)** — was missing |
| `memory.*`, `reflection.*` | `memory/*` | `memory/memory.test.ts` |
| `entity.created`, `character.promoted` | `entities/service.ts` | `entities/entities.test.ts` |
| `world.var_set`, `time.advanced`, `schedule.fired`, `longevent.*`, `offscreen.simulated` | `world/*` | world tests |
| `anchor.*`, `beat.*`, `sidenote.*`, `exception.used` | `director/*` | `director/director.test.ts` |
| `visibility.granted/expired` | `introspect/service.ts` | introspect tests |
| `branch.header`, `branch.forked`, `carry.applied`, `purge.applied` | timeline + carry + purge | timeline tests |
| `config.reloaded/warning/error`, `budget.degraded` | hot-reload, timeline, router | e2e, router tests |

**Documented extensions** (not in §22 table but in `EVENT_KINDS` + reducer): `rule.window_opened`, `rule.threshold_fired`, `field.granted/revoked/age`, `info_arrival`, `world.moved`, `item.moved`, `character.var_set`, `scene.started/ended`, `turn.started/ended`. Used by director, fields, scene lifecycle, and game hooks.

## Fixes applied (this audit)

1. **I2/I4/I6 tests** — `packages/engine/test/conformance/section-a.test.ts`.
2. **Causal `because` + `choice.taken`** — `pipeline/run-turn.ts`.
3. **`source` on adjudication/check deltas** — `rules/adjudicate.ts`, `rules/checks.ts`.
4. **Rule RNG seed** — `rules/rule-engine.ts` + `engine/create-engine.ts`.
5. **Deterministic import branch** — `timeline/export-import.ts` (`import_<sha256>`).
6. **§5 init scaffold** — `packages/cli/src/commands/init.ts`.

## Known risks / integrator notes

- Pass explicit `sessionId` (and optional `now` on `TimelineDeps`) for byte-stable golden logs in CI.
- `derived/` is reserved; populate when rebuildable views land.
- Purge deserves a dedicated integration test when artifact redaction paths stabilize.
