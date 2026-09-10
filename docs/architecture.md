# Animae — Implementation Architecture

> Normative companion to [`spec.md`](./spec.md) (the product spec). The spec says **what**; this file fixes **how the code is organised**
> and pins the decisions the spec leaves open, so that modules written independently fit together.
> Keep this file current: every module owner updates its own section ("Module notes") when behaviour changes.

## 1. Repository layout

```
/ (monorepo root; bun workspaces: animae/packages/*, games/*)
  animae/                      ← itself a monorepo, publishable on its own (own package.json, workspaces: packages/*)
    docs/{spec.md, architecture.md, ...}
    packages/
      engine/        @animae/engine       src/<module>/…, test/…
      preset-base/   @animae/preset-base
      preset-dnd/    @animae/preset-dnd
      i18n/          @animae/i18n         catalogs, ICU subset, locale negotiation, hygiene helpers
      tui/           @animae/tui          Ink 8 components + default layout
      cli/           animae               CLI, `serve --stdio` JSON-RPC, `bun build --compile` script
  games/<host>/                ← the game (depends on animae only through its public packages)
  docs/                        ← product-level docs (spec original, progress log)
```

## 2. Tooling and conventions (all packages)

* **Language**: TypeScript strict, ESM. Source imports use explicit `.ts` extensions (`import { x } from "./x.ts"`); `tsc` rewrites them on build
  (`rewriteRelativeImportExtensions`). `erasableSyntaxOnly` is on: **no `enum`, no `namespace`, no constructor parameter properties**.
* **Dev resolution**: package `exports` point at `src/index.ts` (so no build step in dev); `publishConfig.exports` point to `dist/`.
* **Runtime portability**: engine code must run on Node ≥ 24 *and* Bun. Use `node:` APIs only (fs, crypto, zlib, path…). Never `Bun.*` in `@animae/engine`.
  (`@animae/tui` and `animae` CLI may be Bun-first but must work on Node via the built `dist`.)
* **Tests**: `bun test` with `import { test, expect } from "bun:test"`, files `packages/<pkg>/test/**/*.test.ts` (game: `games/<host>/test`).
  Test doubles (`MemoryStorage`, `ScriptedModel`) may be used in tests only. **Production code must never contain mock/placeholder data.**
* **Typecheck**: `node_modules/.bin/tsc -p tsconfig.json --noEmit` from the repo root must stay green for your files.
* **Dependencies**: add only what is needed (`bun add` inside the package dir). Prefer Node built-ins; no gray-matter/lodash etc. (we parse frontmatter with `yaml`).
* **No unrelated edits**: edit only the directories you own. The CONTRACT files are:
  `engine/src/{types,ports,events,state,preset,api,contracts}.ts`, `engine/src/schema/*.ts`. Additive changes only (new optional fields / new types), and each
  must be appended to the *Contract changelog* (§9). Never rename or remove contract members.
* **Barrels**: each module has `src/<module>/index.ts`, already re-exported from `engine/src/index.ts`. Export only what other modules/packages need;
  avoid name collisions across modules (prefix generic names).
* **Errors**: throw `AnimaeError(code, message, details)`. Config problems: `CONFIG_INVALID` with `file` + `path` in the message.
* **Determinism (I6/I7)**: no `Math.random`, no `Date.now()` inside rules/pipeline decisions. Randomness only via `timeline.rng(key)` (seed + branch root + key). Side jobs that emit events (scene-end reflection, offscreen narrate, memory propagation) run **awaited** inside the mutation gate before the caller resolves (`scene.end`, `world.advance` segments); deferred reflection is flushed synchronously at the next `scene.start`. Timeline `append` is queued so concurrent async work cannot reorder persisted events.
  Wall-clock is allowed only for metadata (`SaveSlot.createdAt`, lock files). All LLM calls go through a `ModelPort` wrapped by record/replay.
* **Docs**: each module owner documents public behaviour in `animae/docs/modules/<module>.md` (short: purpose, API, decisions, edge cases) and keeps it updated.
* **Language of docs/content**: engine code and `animae/docs` are English; game authored content is localized via locale layers (see [`i18n.md`](./i18n.md)).

## 3. Module ownership (engine/src/…)

| Dir | Owner deliverable |
|---|---|
| `store/` | `FsStorage`, `MemoryStorage`, util (sha256, stable JSON, yaml, jsonl, frontmatter, path guards), lock file |
| `policy/` | policy merge (`$append/$prepend`, warnings), preset registry & `extends` resolution, `loadPolicy`, default-filling → `ResolvedPolicy`, validation (refs, CEL, field level vs grants) |
| `authored/` | zod-validated loaders for every authored file, knowledge docs, `Catalog`, `loadAuthored`, content hash |
| `rules/` | CEL engine (cel-js), `RuleEngine` registry, primitives (tiers/hysteresis, delta formula, marginal, turn_cap, decay, windows, thresholds, intent scoring), dice + checks, **`buildCelContext`** |
| `timeline/` | event log, reducer, initial state, snapshots, branches, save/load/rewind/diff/prune/purge, carry, export/import, replay, artifacts (COW), recordings |
| `model/` | AI SDK adapter (`ai@7`), providers, cache breakpoints, record/replay wrapper, `ScriptedModel`, `createModelsFromConfig` |
| `fields/` | field resolution/stacking/caps/grants/costs/ledger |
| `director/` | anchors, beats, sidenotes, exceptions |
| `world/` | calendar, advance, scheduler, long events, offscreen, lazy catch-up, decay ticks |
| `memory/` | memory store, retrieval, knowledge injection, forgetting/distortion/propagation, reflection |
| `introspect/` | `query` path catalogue, visibility policy, grants/expiry, `explain`, viewers |
| `entities/` | template generation, promotion, SillyTavern card import/export (JSON + PNG), `.acard.jsonl` |
| `router/` | escalation triggers, budget, degradation |
| `pipeline/` | prompt builder (segments), classify/appraise, check, adjudicate, applyFields, decide, render (stream, cues, choices), commit, hooks |
| `scene/` | scene lifecycle, turn-taking, NPC autonomous exchanges, scene report |
| `engine/` | `createEngine` (kernel wiring, presets, hot reload, models from config) |
| `rpc/` | JSON-RPC 2.0 server over any duplex (used by CLI `serve --stdio`) |

## 4. Pinned decisions (the spec leaves these open)

### 4.0 Locales (UI, prompts, output, content)
* **UI locale** (`i18n.locale`): all engine-produced system/UI strings (errors, CLI/TUI, validate/doctor, introspection labels). Resolved: explicit config / `createEngine` / CLI `--lang` → `ANIMAE_LOCALE` → `LC_*` / `LANG` → default `en`.
* **Prompt locale** (`i18n.promptLocale`): static LLM scaffolding in `engine/src/prompts/<locale>/`; default `zh-CN` in config resolver (product tuning — not referenced in code strings). English set must stay in parity (`animae i18n check`).
* **Output locale** (`i18n.outputLocale`, default UI locale): player-facing model text; render prompts append output-language directive from catalogs + `Intl.DisplayNames`.
* **Content locale** (`i18n.contentLocale`, default **prompt locale**): LLM-facing `locales/<locale>/` overlays (persona, knowledge, templates). Display `$t:` string tables resolve at **UI locale** via late binding (`liftStringRefs` → `{ i18n: { key } }` → `localize*` at presentation).
* **No natural-language literals in TS** under `animae/` (CJK scan in CI); catalogs use neutral English keys (`error.config.invalid`). Full design: [`i18n.md`](./i18n.md).

### 4.1 Ids, time, RNG
* Event id `evt_` + zero-padded counter (min width 4) — unique within an ancestor chain; child branches continue numbering after `forkAt`.
  Scene `scn_0001`, turn `turn_0001` (counters live in `EngineState`).
* `WorldTime {day>=1, minute 0..1439}`; absolute minutes = `(day-1)*1440 + minute`. `Duration` strings: `90m`, `2h`, `1d`, `1d2h30m`.
* RNG key = `${seed}:${rootBranch}:${key}`; engine uses keys like `turn_0012:check`, `evt_0412:distort`. Hash → xorshift128+/mulberry32 stream.
* Time model: each processed turn advances world time by `calendar.turnMinutes`; at `scene.end`, time advances so that the scene lasted at least `sceneMinutes`.
  Every advance emits `time.advanced` and triggers scheduler/decay/lazy catch-up (`world.runSchedule`).

### 4.2 Tracks, tiers, deltas
* Track scope `relation` (default): value stored per `(owner → target)`; for an event from `actor` to `addressee`, the owner is the *addressee NPC* and the target is the *actor*.
  Scope `self` (e.g. mood): one value per owner. `CharacterState.tracks.{self,toward}`; `tracks.yaml` provides initial values (`toward["*"]` = default for any target not listed).
* Tiers: `tiers[]` sorted by `from`. Hysteresis `h`: tier goes **up** to tier T when `value >= T.from + h` (no buffer when entering from the initial state), and **down** below
  the current tier T when `value < T.from - h`. `tier.changed` is emitted on change. `tier_shift` (L1 field) shifts the *effective* tier index at read time only.
* Delta (per `delta_table[eventType]` entry): `Δ = base × intensity × sincerityFactor × traitMult × marginal(n) × Π(L1 track_mult)`,
  where `sincerityFactor = base>0 ? sincerity : 1`, `traitMult = traits.event_mult[eventType] ?? 1`, `marginal(n) = 1/(1 + k·n)` with `n` = per-(owner,target,eventType) counter decayed by
  `0.5^(hoursSinceLast/halfLifeHours)`. Result rounded to 2 decimals. Then `turn_cap` clamps the *cumulative* |Δ| of a track within the turn, then clamp to `[min,max]`.
  `track_offset` (L1, capped) is applied at read time (effective value), never stored.
* Marginal counters (`EngineState.counters`) are incremented by the **reducer on the `appraisal` event** (owner = addressee, target = actor, key = appraisal.type): `n = n·0.5^(Δhours/halfLifeHours) + 1`
  (reducer is built with the policy's `halfLifeHours`). Therefore adjudicate computes `marginal` with `n_prior = n_decayed_total − 1` (the current event is already counted).
* `track.delta` events carry `{owner,target?,track,delta,before,after,eventType,factors}`; zero deltas are not emitted.
* Decay: world-hour ticks apply `value += (toward - value) * (1 - (1-rate)^hours)` as `track.delta` with `reason: "decay"` (only when |Δ| ≥ 0.01), computed lazily when time advances.

### 4.3 Turn pipeline (per `scene.turn`)
1. `turn.started`; actor input → `input.received`.
2. **appraise** (S1, sync call #1, structured output `Appraisal`) → `appraisal`, `input.classified`; unknown `type` → `other`. Input-class response (`policy.input.response`) overrides the appraisal's event type + forces an intent. Safety (if enabled) → `safety.flagged`.
3. **check** (policy `checks[]` whose `when` is true) → `check.rolled`; `onSuccess/onFailure` may retype the appraisal / add tags / emit events.
4. **adjudicate** (rules): delta table + primitives (+ window/threshold/custom rule fns) → `track.delta`, `tier.changed`, rule-emitted events.
5. **applyFields**: `fields.resolve` for the speaking NPC (L0–L4); emits `field.applied`. L1 effects feed steps 3–4 (resolve a first pass *before* check with scope event unknown → `eventType` = appraisal type is known after step 2, so resolve right after appraise).
6. **decide**: `intent_rules` scoring (+ L2 force/forbid/bias). → `intent.decided`.
7. **route** (router) → `route.decided`.
8. **render** (S1 or S2, sync call #2; S2 may use `search`/`read` tools ≤ 3 steps): structured output `{text, cues[], intent_realized, choices?}`; stream `text` diffs as `TurnChunk.text`; cues as `cue` chunks with `at` offsets; `utterance`, `intent.mismatch`, `choice.offered/filtered`.
9. **commit**: `memory.written` (episodic), `world.var_set`/others from rules, director `afterRender`, promotions check, scheduled advance of time, `turn.ended`, then `done` chunk. Async after the turn: nothing blocks the next turn except the lock on the timeline (writes are serialised through `timeline.append`).
   * Scene end additionally: `scene.ended`, field cost settlement, reflection (S2, per principal; router may defer), propagation tick, snapshot.

### 4.4 CEL context (`buildCelContext`)
Plain JSON-like values. All numbers are passed as doubles (adapter converts for cel-js). Missing → `null`/`{}`/`[]` (never undefined).

| var | shape |
|---|---|
| `self`, `other`, `actor` | `{id,name,lod,tags[],traits{…},vars{…},interactions,location}` (`self` = NPC under evaluation, `other` = counterpart, `actor` = the event's actor) |
| `event` | `{type,intensity,sincerity,approach,tags[],claims[],input_class,positive,text}` |
| `scene` | `{id,location,participants[],turn,first,count}` |
| `world` | `{vars{…},time{day,minute,hour},chapter,location,minutes}` (`location` = player location) |
| `time` | `{day,minute,hour,minutes}` |
| `tracks` | `{<track>: effective number}` for `self` toward `other` (self-scope + relation-scope merged, L1 offsets applied) |
| `tiers` | `{<track>: tierName}` (L1 `tier_shift` applied) |
| `memory` | `{count}` plus helper counts |
| `fields` | `{active:[ids], <id>:true}` |
| `check` | `{success,total,margin,roll…}` (null when no check ran) |
Extra keys may be supplied by callers (`extra`), e.g. `goal`, `conflict`, `proposal`, `choice`, `thresholdId`.

### 4.5 Stores
* `world.vars` is a flat map; keys may contain dots (`base.food`). `engine.world.set(path, value)` writes `world.var_set`. `characters/<id>` vars use `vars` in `CharacterState` (set via rule events `character.var_set` — extension event, see changelog).
* Artifacts: `timelines/<branch>/artifacts/<npc>/memory.jsonl` lines carry `_seq` (event seq at write); reads from ancestors include only lines with `_seq <= forkSeq`.
* Memory ids: `mem_<seq>_<n>`; summaries markdown in `artifacts/<npc>/summaries/<id>.md` with frontmatter.
* Generated entities live in `EngineState.generated` (from `entity.created`) and are mirrored to `timelines/<branch>/entities/<kind>/<id>.json` for readability.

### 4.6 Presets in a single executable
Built-in presets are exported as `PresetBundle` objects (YAML sources are converted to TS by each preset's `scripts/gen-bundle.ts` → `src/generated.ts`, committed).
The CLI / game register them via `createEngine({presets:[…]})`. The game's authored data is embedded the same way (`scripts/gen-data.ts` → `src/data.generated.ts`) and extracted to the user data dir.

### 4.7 Viewers and paths
See `contracts.ts` "Query path catalogue". Base visibility (preset-base §19.4) covers those paths; the TUI only ever calls `engine.query(viewer, path)`.

## 5. Phase plan

**Status: complete (v1.0.0).**

1. **Contracts** — types, schemas, ports, module interfaces.
2. **Parallel module build** — all engine modules, CLI, TUI, presets, example-game content.
3. **Integration** — e2e tests, record/replay determinism (I6), `animae` and `example-game` compiled binaries.
4. **Hardening** — conformance audits ([conformance-a.md](./conformance-a.md), [b](./conformance-b.md), [c](./conformance-c.md)), user-facing docs, packaging.

## 6. Module notes

Per-module behaviour lives in [`docs/modules/`](./modules/) (linked from [docs/README.md](./README.md)). Update the matching file when your module’s public API or invariants change; append contract-only changes to §9 below.

## 9. Contract changelog (append-only)
* (initial) contracts created.
* `contracts.ts`: `MemoryService.flushDeferred()` — run deferred scene reflections after `reflect({ defer: true })`.
* `character.promoted` payload: optional `data` with the merged character definition fields added on promotion (timeline reducer should fold into `EngineState.generated.characters`).
* `exception.used` payload uses `exceptionId` (not `id`) so event envelopes keep `id` as `evt_*` seq ids.
* `events.ts`: extension kinds `rule.window_opened`, `rule.threshold_fired` (payloads `RuleWindowOpened`, `RuleThresholdFired`) — timeline reducer should fold `windows` / `firedThresholds` from these if not already driven by inline adjudicate state updates.
* `events.ts`: extension kinds `field.age`, `info_arrival` (payloads `FieldAge`, `InfoArrival`); reducer folds `field.age` into `ActiveField.scenesElapsed` / `turnsElapsed`.
* `contracts.ts`: `Director.beatNote()` — active beat prompt note.
* TurnChunk: added optional `speaker` (text/cue/done) and `autonomous` (text); one `done` per sub-turn.
* CEL builtins (rules/cel): `abilityMod(int)`, `profBonus(int)`, `maxInt(int,int)` for RPG presets; `self.hard_bottom_line_tags` in CEL context for intent rules.
* Introspect: `npc:<id>` query paths `characters/self/**` alias to `characters/<id>/**` for visibility rules (see `resolveNpcSelfQueryPath`).
* `Kernel.runExclusive` / `Kernel.acquireExclusive` — engine serializes world/scene/timeline mutations; `close()` drains the gate then timeline append queue. Scene-end reflection/offscreen work is awaited before `scene.end` resolves; async timeline appends stay ordered via the append queue.
* World time advance: milestone-ordered decay + schedule + daily, then `time.advanced`, then `director.tick("time_advanced")` at interior anchor/beat checkpoints during the jump (via optional `asOf` time) plus a final tick at destination clock.
* `Director.tick(..., { asOf?: WorldTime })` — simulate anchor/beat evaluation at a wall time before `time.advanced` has committed (used by `world.advance` span checkpoints).
* `MemoryService.reflect` optional `participants` — scene end passes roster after `scene.ended`; deferred queue stores `{ sceneId, participants }` for deterministic flush at next scene start.
* `adjudicate` accepts optional `check` (last `check.rolled` payload) so custom adjudicate rules can read `check.success` in CEL.
* `api.ts` `Engine.queryAsync(viewer, path)` — player location/character queries run §12.6 lazy catch-up before the synchronous visibility-filtered read; RPC `query` uses this. Plain `query()` remains sync and does not await narrate fidelity.
* `policy.render.maxSegmentChars` — optional `{ static?, semiStatic?, dynamic? }` character caps for prompt segments (truncate with marker; default unlimited).
* `ModelSpecSchema.provider` — additive values `deepseek`, `ollama` (native Ollama `/api/chat`, `/api/embed`; default base `http://127.0.0.1:11434`). `resolveApiKey` returns `undefined` when unset (one-time warning via `ModelWarningSink` / `AI_SDK_LOG_WARNINGS` handler); hosted providers still construct and fail at request time on 401.
* **Mods (content packs):** `AnimaeConfigSchema.mods`, `mod.ts` (`ModBundle`, `ModSetupCtx`), layered read-only storage (`mods/`), patch merge operators, `CreateEngineOptions.mods` / `modBundles`, `Engine.mods()`, `config.reloaded.mods`, `EngineState.config.mods`, `config.warning` code `mod_drift`. See [mods.md](./mods.md). Filesystem mods are data-only; `ModBundle.setup()` only from host-registered bundles.
* **Entity aliases:** `entity.alias_set` → `EngineState.aliases`; `Engine.entities.setAlias` / `Engine.setAlias`, `Engine.resolveEntity`; prompt `{{ name }}` / nickname-aware `entityDisplayName`.
* **Dynamic entities:** `entity.spawned` (full validated spec + `data`), `entity.retired`; `Engine.spawnEntity`, `Engine.entities.generateFromBrief` (S2 + seeded procedural fallback); `EngineState.entitySeq` for `dyn-####` ids; hot reload preserves `generated` from timeline.
* **Event decks:** authored `world/decks/*.yaml`; daily draw emits `deck.drawn` (+ optional `emit` drafts); state in `EngineState.decks`; deterministic weighted draw via `timeline.rng`.
* **i18n:** `Engine.setUiLocale(locale)` — runtime UI/display locale only (content overlays + prompt scaffolding unchanged). `SystemMessage` + `message()` / `formatSystemMessage()` for language-neutral timeline copy; `config.warning` events add optional `systemMessage` alongside legacy `message`.
* **Web protocol:** server → client `locale { locale }` after negotiated `hello` / successful `set_locale` (additive to `hello_ok` / `result`).
* **i18n (display API):** `Engine.display.resolve(value, { locale? })`, `Engine.display.entityDisplayName(id, { locale?, viewer?, speaker? })`; `LocalizedMessage` + `renderMessage()`; `scene.turn({ outputLocale? })` per-turn narration language; model `recordingLocales` in recording keys; `validateContentLocalePresence` for the content lane when `locales/` exists.
