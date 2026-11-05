# Animae — Implementation Architecture

> Normative companion to [`spec.md`](./spec.md) (the product spec). The spec says **what**; this file fixes **how the code is organised**
> and pins the decisions the spec leaves open, so that modules written independently fit together.
> Keep this file current: every module owner updates its own section ("Module notes") when behaviour changes.

## 1. Repository layout

```
.                              ← repository root (package.json, workspaces: packages/*)
  docs/{spec.md, architecture.md, ...}
  packages/
    engine/        @animae/engine       src/<module>/…, test/…
    preset-base/   @animae/preset-base
    preset-rule/   @animae/preset-rule
    preset-dnd/    @animae/preset-dnd
    i18n/          @animae/i18n         catalogs, ICU subset, locale negotiation, hygiene helpers
    tui/           @animae/tui          Ink 8 components + default layout
    cli/           animae               CLI, `serve --stdio` JSON-RPC, `bun build --compile` script
```

Host applications live outside this tree; they depend on `@animae/*` through npm or a workspace link.

## 2. Tooling and conventions (all packages)

* **Language**: TypeScript strict, ESM. Source imports use explicit `.ts` extensions (`import { x } from "./x.ts"`); `tsc` rewrites them on build
  (`rewriteRelativeImportExtensions`). `erasableSyntaxOnly` is on: **no `enum`, no `namespace`, no constructor parameter properties**.
* **Dev resolution**: package `exports` point at `src/index.ts` (so no build step in dev); `publishConfig.exports` point to `dist/`.
* **Runtime portability**: engine code must run on Node ≥ 24 *and* Bun. Use `node:` APIs only (fs, crypto, zlib, path…). Never `Bun.*` in `@animae/engine`.
  (`@animae/tui` and `animae` CLI may be Bun-first but must work on Node via the built `dist`.)
* **Tests**: `bun test` with `import { test, expect } from "bun:test"`, files `packages/<pkg>/test/**/*.test.ts`.
  Test doubles (`MemoryStorage`, `ScriptedModel`) may be used in tests only. **Production code must never contain mock/placeholder data.**
* **Typecheck**: `node_modules/.bin/tsc -p tsconfig.json --noEmit` from the repo root must stay green for your files.
* **Dependencies**: add only what is needed (`bun add` inside the package dir). Prefer Node built-ins; no gray-matter/lodash etc. (we parse frontmatter with `yaml`).
* **No unrelated edits**: edit only the directories you own. The CONTRACT files are:
  `engine/src/{types,ports,events,state,preset,api,contracts}.ts`, `engine/src/schema/*.ts`. Additive changes only (new optional fields / new types), and each
  must be appended to the [Contract changelog](#9-contract-changelog-append-only). Never rename or remove contract members.
* **Barrels**: each module has `src/<module>/index.ts`, already re-exported from `engine/src/index.ts`. Export only what other modules/packages need;
  avoid name collisions across modules (prefix generic names).
* **Errors**: throw `AnimaeError(code, message, details)`. Config problems: `CONFIG_INVALID` with `file` + `path` in the message.
* **Determinism (I6/I7)**: no `Math.random`, no `Date.now()` inside rules/pipeline decisions. Randomness only via `timeline.rng(key)` (seed + branch root + key). Side jobs that emit events (scene-end reflection, offscreen narrate, memory propagation) run **awaited** inside the mutation gate before the caller resolves (`scene.end`, `world.advance` segments); deferred reflection is flushed synchronously at the next `scene.start`. Timeline `append` is queued so concurrent async work cannot reorder persisted events.
  Wall-clock is allowed only for metadata (`SaveSlot.createdAt`, lock files). All LLM calls go through a `ModelPort` wrapped by record/replay.
* **Docs**: each module owner documents public behaviour in `docs/modules/<module>.md` (short: purpose, API, decisions, edge cases) and keeps it updated.
* **Language of docs and content**: engine code and `docs/` are English; game authored content is localized via locale layers (see [`i18n.md`](./i18n.md)).

## 3. Module ownership (engine/src/…)

| Dir | Owner deliverable |
|---|---|
| `store/` | `FsStorage`, `MemoryStorage`, util (sha256, stable JSON, yaml, jsonl, frontmatter, path guards), lock file |
| `policy/` | policy merge (`$append/$prepend`, warnings), preset registry & `extends` resolution, `loadPolicy`, default-filling → `ResolvedPolicy`, validation (refs, CEL, field level vs grants) |
| `authored/` | zod-validated loaders for every authored file, knowledge docs, `Catalog`, `loadAuthored`, content hash |
| `rules/` | CEL engine (cel-js), `RuleEngine` registry, primitives (tiers/hysteresis, delta formula, marginal, turn_cap, decay, windows, thresholds, intent scoring), dice + checks, **`buildCelContext`** |
| `timeline/` | event log, reducer, initial state, snapshots, branches, save/load/rewind/diff/prune/purge, carry, export/import, replay, artifacts (COW), recordings |
| `model/` | AI SDK adapter (`ai@7`), tier resolver, `RuleModelPort`, providers, cache breakpoints, record/replay wrapper, `ScriptedModel`, `createModelsFromConfig` |
| `runtime/` | Runtime mode per role (`llm` \| `rule`), turn-boundary switching, fallback to rule backend |
| `rule-backend/` | Deterministic counterparts for every S1/S2 model call (appraisal, render layers, choices, memory, reflection, entities, offscreen, autonomous) |
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
| `gallery/` | CG collection store, ratings, unlock CEL, brief + job queue, `ImagePort` integration |

## 4. Pinned decisions (the spec leaves these open)

### 4.0 Locales (UI, prompts, output, content)
* **UI locale** (`i18n.locale`): all engine-produced system/UI strings (errors, CLI/TUI, `validate`, introspection labels). Resolved: explicit config / `createEngine` / CLI `--lang` → `ANIMAE_LOCALE` → `LC_*` / `LANG` → default `en`.
* **Prompt locale** (`i18n.promptLocale`): static LLM scaffolding in `engine/src/prompts/<locale>/`; set in `animae.yaml` ([`i18n.md`](./i18n.md)). Hosts register additional prompt locales via locale packs; `animae i18n check` keeps scaffold parity across registered locales.
* **Output locale** (`i18n.outputLocale`, default UI locale): player-facing model text; render prompts append output-language directive from catalogs + `Intl.DisplayNames`.
* **Content locale** (`i18n.contentLocale`, default **prompt locale**): LLM-facing locale-pack overlays (persona, knowledge, templates). Display `$t:` string tables resolve at **UI locale** via late binding (`liftStringRefs` → `{ i18n: { key } }` → `localize*` at presentation).
* **No natural-language literals in TS** under `packages/` outside English catalogs (a hygiene test scans for string literals in non-Latin scripts); catalogs use neutral English keys (`error.config.invalid`); other languages arrive as locale packs. Full design: [`i18n.md`](./i18n.md).

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

**S1** and **S2** are *roles* (structured judgment vs free-text generation), not model tiers. Each role is served by backend `llm` (`ModelPort`) or `rule` (`RuleModelPort`). See [spec Section 2.1](./spec.md#21-s1-and-s2-are-roles) and [Appendix A](./spec.md#appendix-a-s1-and-s2-mapping). A synchronous turn makes at most one S1 call (`appraise`) and one S2 call (`render`); with both roles on `rule` it makes none. **`Engine.runtime`** holds the active backends and optional S2 tier; switching is in [Appendix B](./spec.md#appendix-b-runtime-modes-and-switching).

1. `turn.started`; actor input → `input.received`.
2. **appraise** (S1 role, sync call #1 when backend is `llm`; rule backend when `rule`): structured `Appraisal` (+ input class / optional safety in the same call) → `appraisal`, `input.classified`; unknown `type` → `other`. **`applyInputResponse`** (policy `input.response`: `emit` / `intent` / classify-stage `hook`) runs once right after classification, before field resolve. Safety (if enabled) → `safety.flagged`.
3. **applyFields** (L0–L1): `fields.resolve` for the speaking NPC; emits `field.applied`. L1 effects are visible to check/adjudicate (`event.type` is known after step 2).
4. **check** (policy `checks[]` whose `when` is true) → `check.rolled`; `onSuccess/onFailure` may retype the appraisal / add tags / emit events.
5. **adjudicate** (rules): delta table + primitives (+ window/threshold/custom rule fns) → `track.delta`, `tier.changed`, rule-emitted events.
6. **applyFields** (L2–L4): second resolve pass; L2 force/forbid/bias feed step 7. Emits `field.applied` / `field.rejected`.
7. **decide**: `intent_rules` scoring (+ L2 force/forbid/bias). → `intent.decided`.
8. **route** (rules only): picks the **S2 tier** for an LLM render (escalation triggers, budget); writes `route.decided` with `{ appraise, render, triggers, budget: { s1Calls, s2CallsByTier }, … }` — not an S1-vs-S2 render choice ([Section 17](./spec.md#17-routing-budget-s2-tiers-and-caching)).
9. **render** (S2 role, sync call #2 when backend is `llm`; rule backend when `rule`): output `{ narrations?[], text, cues[], intent_realized, choices? }`; stream `TurnChunk` `narration` (speaker-less, before character text), then `text` / `cue` / `choices`; on LLM failure mid-stream with fallback enabled, `{ type: "reset", reason: "fallback" }` then rule replacement ([Section 8](./spec.md#8-cognitive-pipeline)). LLM render may use `search`/`read` tools ≤ 3 steps. Events: `narration` (per paragraph), `utterance`, `intent.mismatch`, `choice.offered/filtered`.
10. **commit**: append narration/`utterance` (optional `utterance.retrieval` log), **await** episodic memory via `memory.writing` (rule template or S1 `memory-write` when configured), narration memory, director `afterRender`, promotions check, field turn-end hooks, scheduled advance of time, then `turn.ended`, then `done` chunk. Timeline writes are serialised through `timeline.append`.
   * Scene end additionally: `scene.ended`, field cost settlement, reflection (S1 role, per principal; router may defer), offscreen narrate / autonomous dialogue (S2 role when allowed), propagation tick, snapshot.

### 4.4 CEL context (`buildCelContext`)
Plain JSON-like values. All numbers are passed as doubles (adapter converts for cel-js). Missing **top-level** bindings → `null`/`{}`/`[]` (never undefined). Indexing a **missing map key** (e.g. `world.vars['k']`) is a runtime `CEL_EVAL` error — see [cel-reference.md — Map keys](./cel-reference.md#map-keys-worldvars-character-vars).

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
| `fields` | `{active:[ids], <id>:true, event_prob:{eventTypeId: Δ}}` — aggregated L0 shifts (empty when none) |
| `check` | `{success,total,margin,roll…}` (null when no check ran) |
| `model` | `{ kind: "s1" \| "s2" \| "rule" \| "", tier?, tags[] }` — active model role/backend during LLM-facing stages ([Section 7.2](./spec.md#72-cel-context-variables), [cel-reference.md](./cel-reference.md)) |
Extra keys may be supplied by callers (`extra`), e.g. `goal`, `conflict`, `proposal`, `choice`, `thresholdId`.

### 4.5 Stores
* `world.vars` is a flat map; keys may contain dots (`base.food`). `engine.world.set(path, value)` writes `world.var_set`. `characters/<id>` vars use `vars` in `CharacterState` (set via rule events `character.var_set` — extension event, see changelog).
* Artifacts: `timelines/<branch>/artifacts/<npc>/memory.jsonl` lines carry `_seq` (event seq at write); reads from ancestors include only lines with `_seq <= forkSeq`.
* Memory ids: `mem_<seq>_<n>`; summaries markdown in `artifacts/<npc>/summaries/<id>.md` with frontmatter.
* Generated entities live in `EngineState.generated` (from `entity.created`) and are mirrored to `timelines/<branch>/entities/<kind>/<id>.json` for readability.

### 4.6 Presets in a single executable
Built-in presets are exported as `PresetBundle` objects (YAML sources are converted to TS by each preset's `scripts/gen-bundle.ts` → `src/generated.ts`, committed).
The CLI and hosts register them via `createEngine({presets:[…]})`. Hosts may embed authored data the same way (a host build step that writes a generated TypeScript module of the data files) and extract it to the user data dir at runtime.

### 4.7 Viewers and paths
See `contracts.ts` "Query path catalogue". Base visibility ([preset-base / Section 19.4](./spec.md#194-animaepreset-base)) covers those paths; the TUI and `animae inspect` call `engine.queryAsync(viewer, path)` when available (sync `query` for other tooling).

## 5. Phase plan

**Status: complete (v1.0.0).**

1. **Contracts** — types, schemas, ports, module interfaces.
2. **Parallel module build** — all engine modules, CLI, TUI, presets.
3. **Integration** — e2e tests, record/replay determinism (I6), compiled `animae` binary.
4. **Hardening** — conformance tests under `packages/engine/test/conformance/`, user-facing docs, packaging.

## 6. Module notes

Per-module behaviour lives in [`docs/modules/`](./modules/) (linked from [docs/README.md](./README.md)). Update the matching file when your module’s public API or invariants change; append contract-only changes to the [Contract changelog](#9-contract-changelog-append-only) below.

## 9. Contract changelog (append-only)
* (initial) contracts created.
* `contracts.ts`: `MemoryService.flushDeferred()` — run deferred scene reflections after `reflect({ defer: true })`.
* `character.promoted` payload: optional `data` with the merged character definition fields added on promotion (timeline reducer should fold into `EngineState.generated.characters`).
* `exception.used` payload uses `exceptionId` (not `id`) so event envelopes keep `id` as `evt_*` seq ids.
* `events.ts`: extension kinds `rule.window_opened`, `rule.threshold_fired` (payloads `RuleWindowOpened`, `RuleThresholdFired`) — timeline reducer should fold `windows` / `firedThresholds` from these if not already driven by inline adjudicate state updates.
* `events.ts`: extension kinds `field.age`, `info_arrival` (payloads `FieldAge`, `InfoArrival`); reducer folds `field.age` into `ActiveField.scenesElapsed` / `turnsElapsed`.
* `contracts.ts`: `Director.beatNote()` — active beat prompt note.
* TurnChunk: added optional `speaker` (text/cue/done) and `autonomous` (text); one `done` per sub-turn.
* TurnChunk: optional `newUtterance` on `text` chunks; consecutive same-speaker `text` chunks between `done` values are utterance fragments unless `newUtterance` is set.
* CEL builtins (rules/cel): `abilityMod(int)`, `profBonus(int)`, `maxInt(int,int)` for RPG presets; `self.hard_bottom_line_tags` in CEL context for intent rules.
* Introspect: `npc:<id>` query paths `characters/self/**` alias to `characters/<id>/**` for visibility rules (see `resolveNpcSelfQueryPath`).
* `Kernel.runExclusive` / `Kernel.acquireExclusive` — engine serializes world/scene/timeline mutations; `close()` drains the gate then timeline append queue. Scene-end reflection/offscreen work is awaited before `scene.end` resolves; async timeline appends stay ordered via the append queue.
* World time advance: milestone-ordered decay + schedule + daily, then `time.advanced`, then `director.tick("time_advanced")` at interior anchor/beat checkpoints during the jump (via optional `asOf` time) plus a final tick at destination clock.
* `Director.tick(..., { asOf?: WorldTime })` — simulate anchor/beat evaluation at a wall time before `time.advanced` has committed (used by `world.advance` span checkpoints).
* `MemoryService.reflect` optional `participants` — scene end passes roster after `scene.ended`; deferred queue stores `{ sceneId, participants }` for deterministic flush at next scene start.
* `adjudicate` accepts optional `check` (last `check.rolled` payload) so custom adjudicate rules can read `check.success` in CEL.
* `api.ts` `Engine.queryAsync(viewer, path)` — player location/character queries run [lazy catch-up (Section 12.6)](./spec.md#126-lazy-catch-up) before the synchronous visibility-filtered read; RPC `query` uses this. Plain `query()` remains sync and does not await narrate fidelity.
* `policy.render.maxSegmentChars` — optional `{ static?, semiStatic?, dynamic? }` character caps for prompt segments (section-aware drops; default unlimited).
* `ModelSpecSchema.provider` — additive values `deepseek`, `ollama` (native Ollama `/api/chat`, `/api/embed`; default base `http://127.0.0.1:11434`). `resolveApiKey` returns `undefined` when unset (one-time warning via `ModelWarningSink` / `AI_SDK_LOG_WARNINGS` handler); hosted providers still construct and fail at request time on 401.
* **Mods (content packs):** `AnimaeConfigSchema.mods`, `mod.ts` (`ModBundle`, `ModSetupCtx`), layered read-only storage (`mods/`), patch merge operators, `CreateEngineOptions.mods` / `modBundles`, `Engine.mods()`, `config.reloaded.mods`, `EngineState.config.mods`, `config.warning` code `mod_drift`. See [mods.md](./mods.md). Filesystem mods are data-only; `ModBundle.setup()` only from host-registered bundles.
* **Entity aliases:** `entity.alias_set` → `EngineState.aliases`; `Engine.entities.setAlias` / `Engine.setAlias`, `Engine.resolveEntity`; prompt `{{ name }}` / nickname-aware `entityDisplayName`.
* **Dynamic entities:** `entity.spawned` (full validated spec + `data`), `entity.retired`; `Engine.spawnEntity`, `Engine.entities.generateFromBrief` (S2 + seeded procedural fallback); `EngineState.entitySeq` for `dyn-####` ids; hot reload preserves `generated` from timeline.
* **Event decks:** authored `world/decks/*.yaml`; daily draw emits `deck.drawn` (+ optional `emit` drafts); state in `EngineState.decks`; deterministic weighted draw via `timeline.rng`.
* **i18n:** `Engine.setUiLocale(locale)` — runtime UI/display locale only (content overlays + prompt scaffolding unchanged). `SystemMessage` + `message()` / `formatSystemMessage()` for language-neutral timeline copy; `config.warning` events add optional `systemMessage` alongside legacy `message`.
* **Web protocol:** server → client `locale { locale }` after negotiated `hello` / successful `set_locale` (additive to `hello_ok` / `result`).
* **i18n (display API):** `Engine.display.resolve(value, { locale?, localizeNames? })`, `Engine.display.entityDisplayName(id, { locale?, viewer?, speaker? })`; `LocalizedMessage` + `renderMessage()`; `scene.turn({ outputLocale? })` per-turn narration language; model `recordingLocales` in recording keys; `validateContentLocalePresence` for the content lane when `locales/` exists; content locale overlays use **first matching locale wins** per path.
* **Gallery:** `ImagePort` + `Engine.gallery` (`GalleryService`); `AnimaeConfigSchema.gallery`; profile paths `gallery/collection.json`, `gallery/images/*`; events `gallery.unlocked|captured|rendered|removed` (reducer no-op); CEL `image.tags`, `gallery.unlocked`, `turn.kinds`; RPC `gallery.*` + `gallery.notice`. See [gallery.md](./gallery.md).
* **Gallery (hardening):** serialized collection writer; job shutdown/queue cancel; image byte sniff + 12 MiB cap; orphan image cleanup; capture context snapshot; unlock independent of rating availability; notice/job filtering for unavailable ratings; image ref-count on delete; `Engine.gallery` typed `GalleryService` only on public `Engine`.
* **Gallery surfaces:** `@animae/host` `SessionHost` gallery accessors + `:gallery` + `onGalleryNotice`; `@animae/web` additive gallery WS messages (protocol version stays 1) + `gallery_notice` broadcast + `GET /api/gallery/image/<id>?v=<imageId>` with `galleryImagePolicy`; `@animae/tui` gallery overlay + `galleryPresentation`; CLI `animae gallery` + `createCommandImagePort` (`--image-command`).
* **Prompt assembly:** merged output contract + prompt-locale section catalogs; section-aware `maxSegmentChars` (drops whole sections; `PromptSegments.diagnostics.droppedSections`); S2-only gated knowledge index (`render.knowledgeIndexMax`); `{{name:<characterId>}}` expansion in `promptText` / `display.resolve`; `lintAssembledPrompt` (incl. internal ids, raw event JSON lines, i18n-key leaks); mod append stub merge; alias labels reject `{{` / `$t:`.
* **Policy `x.prompt.world_facts`:** world tone separate from render-only dialogue/`choices` guidance (`x.prompt.render`). Appraise skips `always` and contextual (`when`) knowledge, full world rules and the narration guidance of `x.prompt.template_partials`; `x.prompt.appraise_static` is the appraise-only block.
* **Reflection prompts:** `buildReflectionPromptSegments` — prose scene recap (utterances, tier changes, appraisals); filters `track.delta` / `time.advanced` / router noise via `x.reflection_skip_kinds`; no raw JSON event dumps.
* **Entity generate / offscreen narrate:** `buildEntityGeneratePrompt`, `buildNarrateLocationPrompt` use the same section catalogs (no English TS literals).
* **Track/tier labels:** optional `label` on policy track tiers; relation lines use localized track/tier words (not raw ids).
* **Memory propagation tick:** `MemoryService.propagateTick(when?: "day" | "scene_end")` — propagation only when `policy.memory.propagation.onTick` matches. `ViewerDef`: custom viewers use `extends` chain + `filter(path, value)`. Event `entity.generate` (live consumer in mutation gate). `utterance.retrieval?: RetrievalLogHit[]` on render commit; `explain` lists `retrieval` chain items. `memory.distorted.owner`. RPC: `setUiLocale`, `display.*`, `mods`, `entities.setAlias|spawn|retire|generateFromBrief`, `scene.turn.outputLocale`. CEL `fields.event_prob`; L1 `track_caps` intersection at adjudicate. `input.response` hook at classify boundary (not `decideIntent`). CEL `event.text` = player line. `router.triggers.mood_spike.track`; `secret_topic` = locked secret tags ∪ `{secret}`. `policy.input.response` hook contract documented in policy-reference.
