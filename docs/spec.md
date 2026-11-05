# Animae Engine Specification v1.0

## 1. Overview

Animae is a gameplay-agnostic character and world runtime. It runs locally as a TypeScript library and provides the following capabilities for interactive narrative such as TRPGs and visual novels:

- Character system
- Cognitive pipeline
- Memory and knowledge
- Field system
- Narrative director
- World and time
- Timeline (saves, rewind, branches)
- Multi-character orchestration
- Introspection and visibility
- Input classification and safety
- Routing, budget and S2 tiers
- Dice and checks
- Runtime modes: every model call has a deterministic rule counterpart, so a game plays with no model at all, and models can be switched on and off while it is running
- Narration: speaker-less text (scene description, transitions) next to character lines

The engine provides mechanisms only. All gameplay-specific choices are injected by upper layers through policy and preset.

## 2. Tech stack and deliverables

| Item | Specification |
|---|---|
| Language | TypeScript (latest stable, `strict`); output is ESM |
| Runtime | Node.js >= 24; Bun latest stable |
| Model layer | Vercel AI SDK Core (`ai@7`), wrapped behind `ModelPort`. The rule backend is a `ModelPort` as well and needs no SDK, network or API key |
| Schema validation | zod 4 |
| Expressions | CEL, implemented with `@marcbachmann/cel-js` 8.x |
| Storage | Local plain-text files (YAML, Markdown, JSONL, JSON) |

| Deliverable | Contents |
|---|---|
| `@animae/engine` | Engine library |
| `@animae/preset-base` | Built-in base preset ([Section 19.4](#194-animaepreset-base)) |
| `@animae/preset-rule` | Rule-first preset: what a game needs to play with no model ([Section 19.6](#196-animaepreset-rule)) |
| `@animae/preset-dnd` | Built-in DnD preset ([Section 19.5](#195-animaepreset-dnd)) |
| `@animae/tui` | Terminal game UI: Ink 8 (React) component library, plus a default game layout ([Section 21](#21-terminal-ui-animaetui)) |
| `animae` | Single executable built with `bun build --compile`, bundling `@animae/tui`, with two modes: interactive CLI/TUI and `animae serve --stdio` (stdio-based JSON-RPC 2.0 sidecar) |

### 2.1 S1 and S2 are roles

S1 and S2 name what a model call is *for*. They are not models, and one provider may serve both.

| Role | Contract | Calls | Served by |
|---|---|---|---|
| **S1** (structured judgment) | A prompt and a JSON schema go in; data that conforms to the schema comes out. Never free text | `appraise` (with `classify` and `safety`), the commit-time memory write, reflection, `entity.generate` | An LLM (`models.s1`: any provider that can return schema-conformant data), or the rule backend |
| **S2** (free-text generation) | Prose, streamed, in one or more **tiers** (`models.s2.tiers[]`, each `{id, provider, model, tags}`); the router picks the tier of each call ([Section 17](#17-routing-budget-s2-tiers-and-caching)) | `render`, offscreen narration (`narrate`, `full`), autonomous NPC dialogue | An LLM tier, or the rule backend |

Each role is served by a **backend**: `llm` (a `ModelPort`) or `rule` (the deterministic, token-free rule backend, [Appendix C](#appendix-c-rule-backend-design)). Stages that are pure rules (`check`, `adjudicate`, `applyFields`, `decide`, `route`) use neither. A synchronous turn makes at most one S1 call and one S2 call; with both roles on the rule backend it makes none. The *runtime mode* says which backend serves each role right now and can change at any turn boundary ([Appendix B](#appendix-b-runtime-modes-and-switching)).

## 3. Engine invariants

| # | Invariant |
|---|---|
| I1 | Engine code must not embed gameplay preferences; all preferences are injected as policy, preset, or schema extensions. |
| I2 | Every state change is appended to the current timeline's event log as an event; any state can be derived by replaying events. |
| I3 | LLM output is proposal only; the adjudicator decides whether to commit it; the commit itself is also recorded as an event. |
| I4 | Every event carries `because` (provenance) and `source` (origin). |
| I5 | All state is readable via `query`; results are filtered by observer and visibility policy. |
| I6 | Given the same seed and LLM recordings, replay is byte-identical. |
| I7 | Rule functions are synchronous pure functions. Stage-hook IO may only use ports provided on `ctx`, and is recorded. |
| I8 | There is a single writer process, enforced by `.animae.lock` under the data root (file contents are the pid). |
| I9 | Backend independence. Every model call the engine makes has a counterpart in the rule backend that answers the same request schema; a game is playable end to end with both roles on rules, and no code outside the model layer depends on which backend answered. |
| I10 | Mode traceability. Which backend served each role of each turn is an event (`route.decided`); every change of the runtime mode (`runtime.mode_changed`) and every fall back from a model to rules (`runtime.fallback_used`) is an event as well. Replay reads these events and never guesses ([Appendix D](#appendix-d-replay-semantics)). |
| I11 | Graceful degradation. Losing a model (timeout, outage, budget) degrades the call to the rule backend when policy allows it, and never corrupts state: what was streamed is voided with a `reset` chunk, the replacement is committed, and the fall back is recorded. Switching models on or off never breaks a running game. |
| I12 | Interface stability. The rule backend answers through the request's own schema: it adds no field and omits none that an LLM answer has, so adjudication, memory, UI and replay cannot tell the backends apart except through `model.kind` and `route.decided`. |

## 4. Architecture

The normative **implementation map** of `packages/engine/src/` modules (responsibilities and boundaries) is [architecture.md section 3](./architecture.md#3-module-ownership-enginesrc). Packages outside the engine (`cli`, `tui`, presets, `i18n`, `host`, `web`) sit in the monorepo layout described there.

At a glance: authored content loads through `authored/`; characters, cards, and template generation live in `entities/`; adjudication, dice, checks, and CEL run in `rules/`; input classification is part of `pipeline/` (appraise); the turn pipeline orchestrates stages in `pipeline/`; persistence and replay in `timeline/` + `store/`; JSON-RPC in `rpc/` (CLI `serve --stdio`).

## 5. Data root directory

```
<root>/
  animae.yaml                 # Engine config: preset, policy list, seed, models (S1, S2 tiers), mode, runtime
  world/
    world.yaml                # Language, calendar, initial world vars, factions catalog, chapter definitions
    locations/<id>.yaml
    items/<id>.yaml
    fields/<id>.yaml
    anchors.yaml
    beats.yaml
    exceptions.yaml
    schedule.yaml
    knowledge/**/*.md         # Knowledge docs with frontmatter
  characters/<id>/
    card.md                   # frontmatter: identity, constraint set, voice; body: persona
    traits.yaml
    tracks.yaml               # Initial values and track overrides
    goals.yaml
    secrets.yaml
    relations.yaml
    knowledge/*.md            # Character-private knowledge (with frontmatter)
  templates/{character,location,item}/<id>.yaml
  policies/*.yaml | *.ts
  timelines/HEAD              # Current branch name (pointer file)
  timelines/<branch>/
    events.jsonl              # First line is branch.header
    snapshots/<eventId>.json
    entities/                 # Dynamically generated characters, locations, items on this branch
    artifacts/                # LLM artifacts: memory text, summaries, reflections
    recordings.jsonl          # LLM recordings (rule-backend answers are recomputed, never recorded)
  saves.yaml                  # Save slot -> { branch, eventId }
  derived/                    # Reserved; created by `animae init`; hosts may write rebuildable views — the engine writes nothing here in v1
  mods/<id>/                  # Optional content-pack overlay (see [mods.md](./mods.md))
  .animae.lock
```

| Rule | Specification |
|---|---|
| Authored files | Files under `world/`, `characters/`, `templates/`, `policies/` apply globally to all branches |
| Branch files | `timelines/<branch>/` belongs to that branch only; child branches may read `entities/` and `artifacts/` on the ancestor chain; writes go only to the current branch (copy-on-write) |
| Snapshots | One snapshot every 200 events and once on each `scene.end` |
| Branch header | `{"kind":"branch.header","branch":"b2","parent":"main","forkAt":"evt_0412"}` |
| Event line | `{"id","kind","t":<WorldTime>,"sid","scene","turn","source","because":[...],...payload}` |

## 6. Character system

### 6.1 Character schema

| Part | Fields |
|---|---|
| Identity `identity` | `id`, `name`, `summary`, `language` (optional, overrides world language), `greeting` (optional opening line for hosts), `style_examples[]` |
| Constraint set `constraints` | `motives[]`; `bottom_lines[]`: `{id, text, tags[], hardness: hard\|soft}`; `taboos[]` (tags) |
| Traits `traits` | Custom dimensions `{name: number}`; `event_mult`: `{eventType: number}` (trait multipliers) |
| Tracks `tracks` | Defined by policy ([Section 7.3](#73-rule-primitives)); character files only store initial values and overrides |
| Goals `goals` | `[{id, text, tags[], priority}]` |
| Secrets `secrets` | `[{id, text, tags[], unlock: <CEL>}]`. `unlock` defaults to `false`. After adjudication in every turn the engine evaluates `unlock` for each still-locked secret of the responding character (`self` = that character, `other`/`actor` = the acting character, so `tracks.trust` is the responding character's trust toward the actor); a true result writes `character.secret_unlocked` (permanent). Only unlocked secrets are queryable (`characters/<id>/secrets`) and injected into the prompt ([Section 17.5](#175-prompt-segments)); locked secret tags drive the `secret_topic` trigger ([Section 17.2](#172-escalation-triggers)) |
| Relations `relations` | `[{to, kind, tracks?, share: <CEL>}]` |
| Level of detail `lod` | `extra` (passerby) \| `supporting` (supporting role) \| `principal` (principal character) |

### 6.2 Level of detail

| LOD | Persisted content | Reflection at scene end |
|---|---|---|
| `extra` | `identity` and a one-line `summary`; no persisted memory | no |
| `supporting` | `identity`, `constraints`, `tracks`, memory | no |
| `principal` | Full schema | yes ([Section 9.7](#97-reflection)) |

LOD decides what is persisted, not which model voices a character: every line is written by S2 at the tier the router selects ([Section 17](#17-routing-budget-s2-tiers-and-caching)), and template generation is an S1 call at every LOD.

Promotion conditions are defined by CEL in templates. On promotion, the engine fills missing fields from the template for the target LOD, then writes a `character.promoted` event.

### 6.3 Dynamic generation

1. Generation may be triggered in three ways: upper layer calls `entities.generate` / `entities.generateFromBrief`, rules or director drafts emit `entity.generate` request events during a live mutation, or anchor `hard` fallback lists include an `entity.generate` draft.
2. **`entity.generate` (request event)**: payload `{ request: { kind, template, id?, hints?, brief? }, reason? }` (same inputs as the entity API). Reducer is a no-op. A consumer runs **only for requests appended live** inside the mutation gate (never on replay, load, rewind, or hot reload): S1 or rule-backend generation, then `entity.created` with `because` referencing the request. Generation failure emits a warning event and does not fail the surrounding mutation.
3. Template file `templates/<kind>/<id>.yaml` contains: `fields` (zod-compatible field definitions), `guidance` (generation guidance text), `defaults`, `promote` (promotion rules).
4. Generation is an S1 call (`entity`): the output is a structured proposal; it passes schema validation and adjudicator validation in order; on success it is written under `timelines/<branch>/entities/` and an `entity.created` event is recorded. The rule backend builds the same proposal field by field from the first source that yields a valid value: the current value (on promotion), a hint from the caller, the template's `defaults` (a list of candidates is a pool drawn with the seeded `ctx.rng()`), the field's own `default`, and last a value synthesized from the field definition; optional fields with no source are left out. A game with no model generates entities too.
5. Location and item generation use the same mechanism as characters.

### 6.4 Import and export

- **Import**: `animae import-card <file>`, supporting SillyTavern character cards V2/V3. The file may be JSON or PNG (reads the `chara` or `ccv3` text chunk).

  | Source field | Target |
  |---|---|
  | `name` | `identity.name` |
  | `description` + `personality` | `card.md` body |
  | `scenario` | `knowledge/scenario.md` (`inject: always`) |
  | `first_mes` | `identity.greeting` |
  | `mes_example` | `identity.style_examples` |
  | `character_book.entries[]` | `knowledge/<n>.md`: `keys` become `when` keyword conditions; `constant: true` becomes `inject: always` |
  | Remaining fields | Stored verbatim in `card.md` frontmatter field `x_import` |

- **Export**: `animae export-card <id>`, producing a `.acard.jsonl` file. The format is the same as in [Section 13](#13-timeline); content is limited to `characters/<id>/`.

## 7. Rules and expressions

### 7.1 Form

- Conditions, numeric values, and priorities in YAML are written as CEL expressions.
- Complex logic may be implemented as synchronous pure TS functions: register with `engine.rules.register(name, fn)` and reference in YAML as `fn: <name>`.
- Rule function signature: `(ctx: Readonly<RuleCtx>) => EngineEventDraft[]`. Inside the function, only `ctx.rng()` may be used: an RNG seeded by timeline and event id.

### 7.2 CEL context variables

`self`, `other`, `actor`, `event`, `scene`, `world`, `time`, `tracks`, `tiers`, `memory`, `fields`, `check`, `model`

`event` includes appraisal fields plus `positive` (from policy `events.types[<type>].positive`) and `text` (the current turn's raw player input from `input.received`, for keyword `when` on imported character books). `fields` includes `active[]`, per-id booleans, and `event_prob` (map of event-type id → aggregated L0 Δ from active fields; empty when none). Full shapes: [architecture.md 4.4](./architecture.md#44-cel-context-buildcelcontext), [cel-reference.md](./cel-reference.md).

`model` is always present: `{ kind: "s1" | "s2" | "rule" | "", tier?: string, tags: string[] }`. `kind` says which role and backend is answering: `s1` or `s2` for an LLM (with `tier` the S2 tier id), `rule` for the rule backend, empty for stages that call no model. Hosts attach capability tags to each model port and to each S2 tier (`models.s2.tiers[].tags`), for example content tier labels. `model.tags` is empty under the rule backend, so a condition such as `'premium' in model.tags` is false there: tag-gated content degrades to its untagged form. Use `'tag' in model.tags` before relying on a tag.

### 7.3 Rule primitives

| Primitive | Parameters |
|---|---|
| `track` | `name`, `min`, `max`, `initial`, `tiers[]` (`{name, from}`), `hysteresis`, `decay` (`{toward, ratePerHour}`) |
| `delta_table` | `{eventType: {track: base}}` |
| `delta_formula` | Fixed as `base * intensity * sincerityFactor * traitMult * marginal(n) * Π(L1 track_mult)` — see [Section 10.2](#102-levels-and-effect-fields) `track_mult` |
| `marginal` | `k`; `n` is the count of like events received by the same NPC, decayed by `halfLifeHours` |
| `turn_cap` | `{track: maxAbsPerTurn}` |
| `window` | `{id, trigger: <CEL>, durationScenes, mult: {track: number}, capToLoss: bool}` |
| `threshold` | `{id, when: <CEL>, emit: <eventDraft or list>, repeat: bool}` |
| `intent_rules` | `[{intent, when: <CEL>, score: <CEL>}]` |

`sincerityFactor` applies only to positive `base`: it equals `sincerity` (0-1). Negative `base` is unaffected.

A **window** is evaluated after the turn's track updates. It opens when its `trigger` holds and no window with the same `id` is still open: the engine logs `rule.window_opened` with the owner, the target and `untilScene`, the scene count at that moment plus `durationScenes`. Through scene `untilScene`, in turns of the same owner and target, the delta of every track named in `mult` is multiplied by `mult[track]`, and with `capToLoss` a positive delta becomes 0 while losses still apply. A **threshold** emits its `emit` drafts and a `rule.threshold_fired` event when its `when` holds; it fires once per owner and target unless `repeat` is set.

### 7.4 Loading and validation

1. Policies load in this order: preset `extends` chain (deep merge, later overrides earlier) -> preset itself -> `policies` list in `animae.yaml` (in list order).
2. When the same key is defined more than once, the later load overrides the earlier and a `config.warning` event is written.
3. Invalid configuration rejects load and errors include file and path. Invalid configuration includes: references that do not exist, type mismatch, CEL compile failure, zod validation failure, field level exceeding grant.
4. **Runtime CEL evaluation** (policy `when`, intent scores, choice filters, knowledge `when`, etc.): failures throw `CEL_EVAL` and **fail the current turn** (`turn.ended` with error; no half-committed pipeline state). Guard optional map keys (`'key' in world.vars && …`) and seed keys under `vars:` in `world.yaml` — see [cel-reference.md — Map keys](./cel-reference.md#map-keys-worldvars-character-vars).

## 8. Cognitive pipeline

```
input -> classify -> appraise -> applyFields(L0-L1) -> check -> adjudicate -> applyFields(L2+) -> decide -> route -> render -> commit
```

Each stage that can use a model has a **backend**: `llm` (a `ModelPort`) or `rule` (the rule backend, [Appendix C](#appendix-c-rule-backend-design)). The other stages are pure rules and never call a model. [Appendix A](#appendix-a-s1-and-s2-mapping) lists every model call with its purpose, schema and rule counterpart.

| Stage | Default implementation | Backend | Replaceability |
|---|---|---|---|
| `classify` | Input class (`normal`, `injection_suspect`, `meta_probe`) comes from the same call as `appraise`; the rule backend matches keyword tables | S1 \| rule | Stage hook |
| `appraise` | Structured output `{type, intensity, sincerity, approach, claims[], search_terms[], tags[], input_class, safety?}`; the rule backend derives it from the choice taken, a `/command`, `appraise.patterns` or `appraise.fallback` ([Appendix C.2](#c2-appraisal-and-classification)) | S1 \| rule | Stage hook |
| `applyFields` | Resolve active fields per [Section 10](#10-field-system); **two passes**: L0–L1 after appraise (feeds check/adjudicate), L2–L4 after adjudicate (feeds decide) | rules only | Rules (conflict resolver) |
| `check` | When policy declares check rules, roll dice and write `check.rolled` event | rules only | Rules |
| `adjudicate` | Emit `track.delta` events per event type and rule primitives | rules only | Rules |
| `decide` | Score per `intent_rules`, take highest; ties break by declaration order | rules only | Rules |
| `route` | Select the S2 tier of the turn and what the turn may spend per [Section 17](#17-routing-budget-s2-tiers-and-caching); write `route.decided` | rules only | Policy |
| `render` | Stream the reply as `text`, `narration` and `cue` chunks; attach choices per policy | S2 \| rule | Stage hook |
| `commit` | Append narration/utterance events, **await** episodic memory write (`memory.writing`: S1 or rule), narration memory, promotions, field turn-end hooks, turn time advance, then `turn.ended` | S1 \| rule | -- |

Side jobs after the player sees the reply run on `world.advance` / `scene.end` (S2 \| rule unless budget skips them): offscreen narration, offscreen dialogue, autonomous NPC exchanges. Reflection is **awaited** before `scene.end` resolves ([Section 9.7](#97-reflection)) (or flushed at the next `scene.start` when deferred). Live `entity.generate` requests run inside the mutation gate when appended ([Section 6.3](#63-dynamic-generation)), not on replay.

**Synchronous calls**: model calls that block the player from seeing the reply. At most two per turn: one S1 call (`appraise`) and one S2 call (`render`). A role served by the rule backend makes no call, so a turn makes 2, 1 or 0 model calls depending on the runtime mode ([Appendix B](#appendix-b-runtime-modes-and-switching)). `route.decided` states what the turn was entitled to (`budget.s1Calls`, `budget.s2CallsByTier`).

**Stage hooks**: a hook is a function `(ctx, next, k) => Promise<unknown>`, where `ctx` is the turn context, `next()` runs the next hook or the default implementation of the stage, and `k` is the kernel (its ports are the only IO a hook may use, per invariant I7). A hook may call `next()` and post-process its result, or skip it to replace the stage. Hooks of one stage nest in registration order, the first registered outermost: `engine.hooks.register(stage, fn)`.

**Generation output schema**: `{narrations?[], text, cues[], intent_realized, choices?[]}`. It is the same schema for every backend ([I12](#3-engine-invariants)).

- `text`, the line of the speaking character, is required and not empty.
- `narrations` is optional; see *Narration* below.
- When `intent_realized` disagrees with `decide`, record an `intent.mismatch` event. Whether to retry is controlled by policy `render.retryOnMismatch`, value 0 or 1. Both apply to the `llm` backend only: the rule backend states the intent it realized by construction (the `intent` of the pool line, else the intent `decide` chose), so it never mismatches and never retries.
- The S2 tools `search` and `read` ([Section 9.3](#93-retrieval)) are offered to an `llm` render only. A rule render retrieves nothing.

**Cues**:

- Cue chunk format: `{type:"cue", cue:{type, args}, at:<text character offset>}`.
- Available cue types and argument schemas are declared in policy `cues.types`. A cue whose type is not declared, or whose arguments do not match, is dropped, whether a model or a template line produced it.

**Choices**:

- Policy `choices` config: `{enabled, count, filter: <CEL>, rules?}`.
- When enabled, the same `render` output includes `choices[]`; each item is `{text, expected_event_type, tags[]}`, plus optional `intensity`, `sincerity` and `approach`, which are what the choice appraises to when it is taken.
- The `llm` backend writes the choices. The rule backend takes them from `choices.rules`: the rules whose `when` holds, in order, at most `count` ([Appendix C.4](#c4-choices)).
- Options failing `filter` are dropped and a `choice.filtered` event is recorded.

**Narration**: speaker-less text, for example a scene description, a transition or a sound off stage.

- A narration paragraph has no speaker, no cues, no choices and no `intent_realized`; it is not part of any character's reply.
- A render answer carries it in `narrations[]`, a list of `{style, text}`. `style` is `normal` (an ordinary paragraph, the default) or `scene_break` (a divider; its text, if any, is a caption such as a time skip). There is no other style. In the output object `style` is written before `text`, so a streaming consumer knows how to present a paragraph before its text arrives.
- Each paragraph becomes one `narration` event `{kind: "narration", text, style, because}` written before the turn's `utterance` event.
- It streams as `TurnChunk` `narration` ([Section 20.1](#201-typescript-api)) with the semantics of `text` chunks, ahead of the character's line. A render with no `narrations` produces no narration chunk and no narration event.
- Narration is not written to any character's memory, unless policy `memory.writing.narration` says so ([Section 9.1](#91-memory-entries)).
- Visibility: a viewer sees a narration event when it may read `events` and no rule denies `events/narration` (or, for a scene break, `events/narration/style:scene_break`) ([Section 15](#15-introspection-and-visibility)).
- The rule backend produces narration from template layers whose pool lines have `style: narration` or `narration_break` ([Appendix C.3](#c3-render)). Under both backends the narration of a turn, its style and its order are recorded in the log, so replay reproduces it.

**Stream resets**: when the render that was streaming fails and `runtime.fallbackOnError.render` is on, the engine yields `{type: "reset", reason: "fallback"}`, then streams the rule backend's replacement. A consumer discards every `text`, `narration`, `cue` and `choices` chunk it received since the player's own line (the echo stays) and since the last `done`; for an autonomous exchange, which has no player line, since its start. A reset never follows `done`. If nothing had streamed yet there is nothing to discard and no `reset` is sent. The reason `retry` is reserved for a replacement that is not a fallback; the default pipeline never needs it, because with `render.retryOnMismatch: 1` it holds the first answer back until its intent has been checked.

**Output language** (BCP 47; affects `render` and entity-generation prompts): per-turn `scene.turn({ outputLocale })` if set, else engine `i18n.outputLocale` (defaults to UI locale), else speaking character `identity.language`, else `language` in `world.yaml`, else `en`. When the working prompt locale differs, render appends an output-language reminder ([i18n.md](./i18n.md)).

**Recent dialogue window**: `buildRecentHistory` supplies the last K turn ids from policy `render.recentTurns` (default 12) to appraise and render. Lines are filtered by **scene participation** before the K window is applied (invisible turns never consume K). A line is visible to speaker S in scope `{sceneId?, participants}` when: the line has no `scene` id; or it belongs to the scope scene; or S is a catalog character who participated in the line's scene (via `scene.started` participants); or S is not a character and the line's scene shares at least one non-player participant with the scope scene. Callers pass explicit scope when `state.scene` is cleared (reflection after `scene.end` passes the captured roster and ended scene id). Memory recall, reflection narrative, and scene-scoped event views use the same scene boundaries; cross-scene facts must travel via memory propagation or authored knowledge, not the dialogue window.

## 9. Memory and knowledge

### 9.1 Memory entries

Memory entries live in `artifacts/<npc>/memory.jsonl`, format:

```
{id, t, kind: episodic|semantic|summary|reflection, text, tags[], claims[{s,p,o}], importance(0-1), valence(-1-1), src: eventId, branch}
```

**Writing**: after each utterance the engine writes an episodic memory for the speaker (policy `memory.write`: `episodic`, `minIntensity`, `maxChars`). Policy `memory.writing` controls where its text and weights come from:

| Key | Meaning |
|---|---|
| `backend` | `rule` (default): `template` and the tables below. `s1`: ask the S1 role for `{text, importance, valence}` (purpose `memory-write`) on turns whose S1 role is on a model; when S1 is served by the rule backend, or the call fails and `runtime.fallbackOnError.memoryWrite` is on, the rule path answers |
| `template` | `{{ CEL }}` template of the memory text; `text` is the utterance and `speaker` its speaker id. Default `{{text}}` |
| `importanceByEventType` / `valenceByEventType` | Fixed importance and valence per appraised event type; otherwise the appraised intensity and a neutral valence |
| `narration` | What narration leaves in memory: `none` (default), `inject_belief`, `shareable` |

`narration` values: `none` writes nothing, narration is for the player's eyes only. `inject_belief` gives every non-player character in the scene a **semantic** memory (tags `[narration]`) of each `normal` paragraph, as a fact the narrator established. `shareable` writes **episodic** memories instead (tags `[narration, shareable]`, `shareable: true`) so the paragraph spreads like hearsay ([Section 9.6](#96-propagation)). `scene_break` paragraphs are structure and never memory; a scene whose only participant is the player has nobody to remember, so nothing is written. The player is never a witness. Importance comes from `importanceByEventType.narration` (default 0.4).

### 9.2 Knowledge documents and frontmatter injection

Knowledge docs are Markdown under `world/knowledge/**/*.md` and `characters/<id>/knowledge/*.md`. Summary memories are written as Markdown with frontmatter under `artifacts/<npc>/summaries/`.

```yaml
---
name: harbor-history
description: Founding history of Mist Harbor and the old lighthouse incident
scope: world | location:<id> | character:<id> | scene:<id>
inject: always | when | on-demand
when: "scene.location == 'harbor' || 'lighthouse' in event.tags"   # required when inject: when
tags: [harbor, lighthouse]
priority: 0
---
Body text...
```

| `inject` value | Injection behavior |
|---|---|
| `always` | While in scope, body injects into the **static** prompt segment ([Section 17.5](#175-prompt-segments)) |
| `when` | When CEL condition is true, body injects into the dynamic segment |
| `on-demand` | Only `name` and `description` go in the index segment; at most 50 in scope, sorted by `priority` descending. Body loads on retrieval hit or when S2 calls the `read` tool |

### 9.3 Retrieval

- **Recall**: Case-insensitive substring and regex match on `appraise.search_terms` over in-scope memory entries and knowledge docs. No index is built.
- **Scoring**: `0.5 * term hit rate + 0.2 * recency + 0.2 * importance + 0.1 * field salience weight`. Recency half-life is 7 world days.
- **Take**: Top 8 by score (K = 8), inject into dynamic segment.
- **S2 turns**: S2 may use tools `search({query, scope, tags})` and `read({id})`, at most 3 steps; tool results are recorded.
- **Vector retrieval**: `EmbeddingPort { embed(texts: string[]): Promise<Float32Array[]> }`. When a port is wired and `memory.weights.vector > 0`, memory entries **and knowledge doc bodies** use the same vector blend as term/recency/importance/salience (engine default weight **0.3** when embeddings are enabled; `@animae/preset-base` sets `vector: 0` so blending is opt-in).

### 9.4 Forgetting

- Controlled by policy `memory.forgetting`; disabled when `enabled: false`.
- Retention: `retention = exp(-ageDays / (tau * (0.5 + importance)))`.
- Entries below `threshold` are excluded from retrieval but not deleted.

### 9.5 Distortion

- Controlled by policy `memory.distortion`: `{enabled, p, maxImportance, kinds: [intensify, swap_subject, add_motive]}`.
- On retrieval hit, effective probability `p_eff = min(1, p + hops × distortionPerHop × 0.05)` where `hops` is propagation hop count on the entry; attach a distortion instruction and write `memory.distorted` with `owner` (character whose memory was hit).
- Original text never changes; distortion applies only to that `render`.

### 9.6 Propagation

- Controlled by policy `memory.propagation`: `{enabled, onTick: "day" | "scene_end", distortionPerHop}` (default `day`). Propagation runs only when `onTick` matches the tick source: day-boundary ticks inside `world.advance` (`"day"`), or `scene.end` (`"scene_end"`).
- Each propagation tick, for entries marked `shareable`, propagate one hop along edges where `relations[].share` is true.
- Each hop increments distortion count and writes `memory.propagated` event.

### 9.7 Reflection

- On `scene.end`, invoke reflection (S1 structured judgment, not prose) **awaited inside scene end** before `scene.end` resolves — once per `principal` character unless the router defers it (`defer_reflection`), in which case it runs at the next `scene.start` via `flushDeferred`. Output proposal: `{summaries[], goal_changes[], new_claims[]}`.
- Policy `reflection.backend` chooses who answers: `s1` (default) follows the S1 role, so it is an LLM while a model serves S1 and the rule backend otherwise; `rule` always uses the rule backend. The rule backend proposes one summary rendered from the `{{ CEL }}` template `reflection.summaryTemplate` and no goal changes or claims (those need judgment); without a template it proposes nothing. A reflection finishes on the backend it started on, even if the runtime mode changes meanwhile.
- Adjudicator validates proposal per policy `reflection.accept`. Default rule: reject when goal `tags` intersect constraint set `taboos` or `bottom_lines[].tags`.
- Accepted proposals write `reflection.accepted`; rejected write `reflection.rejected`.

## 10. Field system

### 10.1 Field definition

```yaml
id: rainy-old-building
holder: { kind: character|location|item|time|world|external, ref: old-building }
source: author | rule | anchor | runtime
scope: { scene?: <id>, location?: <id>, turns?: n, time?: {from,to}, when?: <CEL> }
level: L0 | L1 | L2 | L3 | L4
effects: { ... }          # fields must match level
priority: 0
stacking: add | max | override | resolver:<fn>
cost: { payer: <entity>, effects: {...}, due: <CEL>, ttlScenes: 3, fallback: {...} }   # optional
```

### 10.2 Levels and effect fields

| Level | Target | Effect fields |
|---|---|---|
| L0 narrative conditions | Environment and timing | `world_vars`, `event_prob: {id: Δ}`, `salience: [{tags, boost}]`, `topic_access: {open[], close[]}`, `schedule_offset: {id: minutes}` — `world_vars` and `topic_access` are **narrative-only** (rendered into the model prompt; no mechanical gating). Aggregated `event_prob` Δ per id is shown in the field-effects prompt block and exposed as CEL `fields.event_prob` (rules may read; the engine does not roll events from it) |
| L1 numeric | Tracks and checks | `track_mult: {track: {eventType\|"*": m}}`, `track_offset`, `track_caps: {track: {min?, max?}}` (at adjudicate, final track value is clamped to policy `[min,max]` ∩ aggregated field caps — fields may only **narrow** the range), `tier_shift`, `check_mod: {skill\|"*": {bonus, advantage}}` |
| L2 intent | Intent | `intent_force`, `intent_forbid[]`, `intent_bias: {intent: score}` |
| L3 rules | Rules | `rule_override: {ruleId: ruleId}`, `rule_add[]` (same shape as `rules.custom` entries) |
| L4 perception | NPC self-view | `hide_entities[]`, `disguise: {entity: asEntity}`, `inject_belief: [{text, tags, claims}]`, `suppress_memory_tags[]` |

**L3 semantics (while the field is in scope)**

- `rule_add`: array of `{id, fn, when?, stage?}` (`stage` defaults to `adjudicate`). Entries run like policy `rules.custom` for their stage: policy rules first, then field rules ordered by field priority (desc), field id, then array order (duplicate ids: last wins). Drafts use the same validation as policy rules; event `source` includes field provenance.
- `rule_override`: `{originalId: replacementId}` (one hop). When `originalId` would run (policy or active `rule_add`), the replacement entry's `fn` runs in that slot; the **original** entry's `stage` and `when` still apply. Lookup is among policy custom rules and active `rule_add` entries. Conflicting overrides merge via field stacking (higher level / priority wins). Unknown ids or unregistered `fn` fail at grant/declare when checkable, otherwise throw or emit a diagnostic at run time — never silently skip.
- Stages wired: `adjudicate`, `scene_start` (after `scene.started`), `scene_end` (after field scene-end costs, before `scene.ended`), `daily` (day boundary). Stage `tick` is reserved for schedule item hooks only; policy and field `rule_add` must not use `tick` (load validation error).

### 10.3 Grants

- Configured by policy `fields.grants`: `[{holder: <CEL>, source: <CEL>, maxLevel}]`.
- If declared field level exceeds grant, load fails. For runtime-granted fields, write `field.rejected` event.
- Numeric caps from policy `fields.caps`; excess is clamped and marked `clamped` on `field.applied` events.

### 10.4 Resolution

1. Collect all fields whose scope matches.
2. Group by level; within group sort by `priority` descending.
3. Merge same field per `stacking` rules.
4. L4 effects write only to `npc:<id>` self-view; they do not change ground truth.

### 10.5 Ledger

| Event | When written |
|---|---|
| `field.applied` | Each time a field takes effect |
| `field.rejected` | Each time a field is rejected |
| `field.cost_due` | Cost becomes due |
| `field.cost_settled` | Cost settled, or settled via `fallback` |

The ledger is a view derived from the above events; it is always recorded; who may see the ledger is determined by visibility policy.

## 11. Narrative director

| Mechanism | Definition |
|---|---|
| Anchors `anchors.yaml` | `{id, target: {kind: world_event\|info_arrival\|character_state\|character_choice, spec}, deadline: <WorldTime\|CEL>, strategies: [soft, hard, force], soft: <L0 field>, hard: <fallback event>}`. `force` requires L2 grant. When less than one scene remains before deadline, `soft` applies; if deadline passes unmet, run `hard`; `force` applies on the last turn before deadline. During this period write `anchor.progress`, `anchor.fulfilled`, `anchor.fallback` events in sequence |
| Beats `beats.yaml` | `[{id, enter: <CEL>, exit: <CEL>, fields: [ids]}]`, ordered; only one beat is active at a time |
| Sidenote | `director.sidenote(npc, text, {ttlTurns, verbatim: bool})`. Hint text injects into dynamic segment; the note lives for `ttlTurns` turns (default 3), counted down at each `turn.ended`, so a note with `ttlTurns` 1 or 0 is seen by one turn only. When `verbatim: false`, if generated content contains 8 or more consecutive characters from the hint text, write `sidenote.echoed` event |
| Exception channel `exceptions.yaml` | `{id, charges, period: session\|day\|chapter, mayBypass: [field_cap, cost_due, track_cap, rule:<id>, constraint:<id>]}`, used via `director.invokeException`, writes `exception.used` event |

## 12. World and time

### 12.1 World state

| Part | Source |
|---|---|
| `world.vars`, locations, items | Event-sourced (timeline reducer) |
| `factions` | Authored catalog in `world/world.yaml` `factions:` (`id → {name, summary?, vars?}`); mutable faction runtime state lives in `world.vars` if needed. There are no `faction.*` timeline events in v1 |

### 12.2 Calendar

Configured in `world.yaml`:

```yaml
language: en
calendar:
  units: { minute: 1, hour: 60, day: 1440 }
  sceneMinutes: 30
  turnMinutes: 1
  chapters: [{ id: ch1, days: [1, 7] }, { id: ch2, days: [8, 14] }]
start: { day: 1, minute: 480 }
```

`WorldTime` format is `{day, minute}`. `world.advance` advances by minute, hour, or day, or jumps to a specific time.

### 12.3 Scheduler

Each entry in `schedule.yaml`:

```
{id, at|every: <WorldTime|"day 08:00">, emit: <eventDraft> | rule: <fn>, duration?, phases?: [{id, minutes}], onInterrupt?: <rule>}
```

On trigger, write `schedule.fired` event.

### 12.4 Long events

- Schedule items with `duration` and `phases` are long events.
- When catching up to observation time, determine current phase from elapsed duration and write `longevent.phase` event.
- On player intervention run `onInterrupt` rule and write `longevent.interrupted` event.

### 12.5 Calendar-span simulation vs entity catch-up

**Calendar-span simulation** (schedule, track decay, daily rules, long-event phases) runs **once globally** on each `world.advance` / turn-scene time jump inside `world/service.ts` — not again per entity.

**Entity catch-up** ([Section 12.6](#126-lazy-catch-up)) advances a location or character's `lastSimulated` marker to now and, by fidelity, may add narrate/full artifacts. It does **not** re-run schedule or decay.

| Fidelity | Catch-up behavior |
|---|---|
| `none` | No catch-up |
| `rule` | Write `offscreen.simulated` only (marker) |
| `narrate` | Marker plus one offscreen narration sentence/artifact for locations (S2 `offscreen` or `offscreen.narrateTemplate`) |
| `full` | On top of `narrate`, record scheduled offscreen meetings; spend per [Section 17](#17-routing-budget-s2-tiers-and-caching) |

Fidelity is configured by policy `offscreen.fidelity`, per location and per character.

`offscreen.narrateTemplate` is a `{{ CEL }}` template over `location` (`id`, `name`, `summary`) and `time`; it is the text the rule backend writes for an offscreen location, and what stands in for the S2 sentence when the S2 role is on the rule backend or its call fails with `runtime.fallbackOnError.offscreen` on. Without a template the rule backend writes nothing. Offscreen narration is a side job: it runs on the backend the runtime mode names when the catch-up starts, and the router may skip it under budget pressure (`skip_offscreen_narrate`).

### 12.6 Lazy catch-up

When any of the following occurs, the engine catches the corresponding location or character up from `lastSimulated` to the current time (see [Section 12.5](#125-calendar-span-simulation-vs-entity-catch-up)):

- A scene starts and involves that location or character;
- Observer `player` reads that location or character via **`engine.queryAsync`** (sync `Engine.query` does not catch up).

After catch-up completes, write `offscreen.simulated` event.

## 13. Timeline

| Capability | Spec |
|---|---|
| Save | `timeline.save(label)`: writes `{branch, eventId}` to `saves.yaml` |
| Load | `timeline.load(slot)`: replays from the nearest snapshot; replay serves `llm` turns from recordings and recomputes `rule` turns ([Appendix D](#appendix-d-replay-semantics)) |
| Rewind | `timeline.rewind(eventId)`: forks a new branch at that event, writes `branch.header` and `branch.forked` events; the original branch is unchanged |
| Branches | `timeline.branches()` lists all branches; `timeline.switch(branch)` switches branch; `timeline.diff(a, b)` returns state and event differences between two branches |
| Carry set | Configured by policy `timeline.carry`: `[{characters: [ids]\|"*", kinds: [memory, track, world_var], tags: [..], when: <CEL>}]`. When forking a branch, matching entries are copied to the new branch, tagged with `carriedFrom`, and a `carry.applied` event is written |
| Prune | `timeline.prune(branch)`: deletes the directory of a branch that has no child branches |
| Purge | `purge(scope)`: physically deletes matching artifacts; corresponding text fields in the event log are replaced with `"[redacted]"`; writes a `purge.applied` event |
| Export | `timeline.export(branch, {recordings: bool})`: exports to a single `.asave.jsonl` file. Line 1 is a manifest `{engine, preset, branch, chain[], hashes}`; each following line is `{path, content}`. Content includes world definitions, character definitions, policies, events and artifacts on the full ancestor chain from the root branch to the current branch, and optional recording data |
| Import | `timeline.import(file)`: validates hashes on import and creates a new branch |
| Playback | `timeline.replay(branch, {from, to})`: emits `TurnChunk` values turn by turn, the `text`, `narration` and `cue` chunks of the recorded utterances. It follows the log: the backend of each turn comes from its `route.decided` event, not from the current mode ([Appendix D](#appendix-d-replay-semantics)) |
| Recording | Each line in `recordings.jsonl` is `{key: hash(model, prompt, params, seed), response}` (optional `v: 2` on stream rows). Object calls store the parsed value; stream calls store slim `StreamPart[]` (`tool` + `final` only, no cumulative `partial` rows). Append is skipped when the key already resolves to the same canonical response (last-wins across the branch chain). In record/live mode the engine may compact a branch file in place (last-wins dedupe, strip legacy partials) when the file is large or redundant. Replay serves object values as-is; for slim streams it re-yields stored tools then one synthesized `partial` (final value) and `final` (legacy rows that still contain partials replay verbatim). Only calls served by an `llm` backend are recorded; the rule backend recomputes its answers from the seed and the log. In replay mode a call that the log says an `llm` backend served needs its recording, and a missing one is an error (`RECORDING_MISSING`, with the turn and key of every missing recording); a `rule` call needs none |
| Hot reload | At the end of each turn, authored file hashes are compared. On change, reload and validate: if validation passes, write a `config.reloaded` event (with new hashes); if validation fails, keep the old configuration and write a `config.error` event. During replay, if configuration hashes differ, a `config.warning` event is written; it concerns the turns produced after it and never changes how recorded turns replay |

## 14. Multi-character orchestration

| Item | Spec |
|---|---|
| Participants | Specified by `scene.start({participants})`; may include any number of NPCs |
| Turn taking | Configured by policy `scene.turnTaking`: `addressed` (the addressed character speaks), `round_robin` (speak in rotation), or `priority: <CEL>` (highest-scoring character) |
| Autonomous NPC dialogue | Configured by policy `scene.autonomous`: `{maxExchangesPerPlayerTurn, when: <CEL>, rules?}`. Each exchange runs the full turn pipeline, on the S2 tier `models.s2.routing.autonomous`, and counts toward budget. Under the rule backend an exchange is voiced by `scene.autonomous.rules`, template layers shaped like `render.layers` ([Appendix C.3](#c3-render)); without rules the exchange is skipped, writes nothing and costs nothing |
| S2 budget | One shared pool of above-default-tier S2 calls within the scene (`router.budget.sceneS2Pool`), consumed in escalation-trigger order by renders and side jobs alike |

## 15. Introspection and visibility

| Item | Spec |
|---|---|
| Viewers | Five built-in: `debug` (always fully visible), `author`, `gm`, `player`, `npc:<id>` (character self-view, with L4 effects applied). Custom viewers: `introspect.registerViewer({ id, extends?, filter? })` — visibility resolves the viewer's grants/rules, then (if `extends`) the extended chain (cycle-safe), then built-ins; `filter(path, value)` post-filters query results (`undefined` hides). Same chain for `canRead`, `query`, `explain`, and event filtering |
| Paths | Normative catalogue in `packages/engine/src/contracts.ts` (Query path catalogue) and `introspect/query.ts`. Includes `characters`, `characters/<id>/{identity,constraints,traits,tracks,tiers,goals,secrets,memory,knowledge,alias}`, `world/{vars,locations,items,time,chapter,location,fields}`, `scene`, `director/anchors`, `director/beat`, `ledger`, `events`, `timeline`. Narration sub-paths: `events/narration`, `events/narration/style:scene_break` |
| `query` vs `queryAsync` | `query(viewer, path)` reads the in-memory projection with visibility only — **no lazy catch-up**. `queryAsync(viewer, path)` runs [Section 12.6](#126-lazy-catch-up) for `player` location/character paths first, then returns the same filtered read. JSON-RPC `query`, TUI `useQuery`, and `animae inspect` use `queryAsync` when available |
| Visibility policy | `visibility.rules: [{viewer, path: <glob>, allow: bool, kinds?: [<glob>]}]`, evaluated in order; the last matching rule wins; deny when no rule matches. `kinds` narrows an `events` rule to event kinds. **Narration** is global (it has no owner), so it is governed by the viewer's `events` rule; a rule on `events/narration` or `events/narration/style:scene_break` can only narrow that, never widen it: a viewer who may not read `events` sees no narration, and a viewer with a matching deny rule sees no paragraph (no scene break, for the second path) unless a temporary grant covers that path. **Child paths**: `characters/<id>/<sub>` and `world/locations/<id>` are readable when their own rule or the parent rule (`characters/<id>`, `world/locations`) allows them, except that a rule matching the child path itself and denying it wins over the parent's allow (an active grant on the child path still lifts that deny) |
| Temporary grant | `grant(viewer, path, ttl)`: writes a `visibility.granted` event; on expiry writes a `visibility.expired` event. `revoke(viewer, path)` ends the grants for exactly that viewer and path early by writing the same `visibility.expired` event (no event when none is active) |
| explain | `explain(turnId, viewer)` returns the event chain for that turn: input, appraisal, checks, track changes, fields, intent, routing, narration, and **`retrieval` items** (from `utterance.retrieval` on the turn: id, score, source `memory` \| `knowledge`, owner — no bodies; memory text only when the viewer may read that owner's memory). Filtered by visibility |
| Subscribe | `on(kind, handler)`; `kind` supports wildcards |

## 16. Input classification and safety

| Item | Spec |
|---|---|
| Input class | `normal`, `injection_suspect`, `meta_probe`; emitted by `appraise`. The rule backend matches keyword tables: a small English default set plus the phrases of policy `appraise.inputClass` (`injection`, `metaProbe`: lists of case-insensitive regular expressions, in any language) |
| Class response | `input.response`: `{class: {emit: <eventType>, intent: <intent>} \| hook: <ruleId>}`. **`emit` / `intent`**: applied once right after classification (before check/adjudicate). **`hook`**: runs once at the same boundary (rule stage `classify`, RNG `classify:<turnId>:<class>`, CEL includes `event.text` = player line); returned drafts append with source `rules:classify`. Reserved draft kinds interpreted locally: `intent.decided` overrides intent; `{appraisal}` merges into appraisal. See [policy-reference.md](./policy-reference.md#inputresponse) |
| Safety classification | Off by default. Enable with policy `safety.enabled: true`. When enabled, `appraise` also emits `safety` as one of `none`, `self_harm`, `real_world_danger`, `sexual_minors`, `personal_crisis`. The rule backend cannot judge content and always answers `none`; a game that needs the classification keeps S1 on a model |
| Safety response | `safety.response: in_character \| out_of_character_notice \| block \| hook:<fn>` |
| Safety logging | `safety.log: bool`. When `true`, writes a `safety.flagged` event |

## 17. Routing, budget, S2 tiers and caching

### 17.1 S2 tiers and routing

`models.s2` lists the tiers of the S2 role in ladder order, cheapest first ("above" and "below" mean later and earlier in the list): `tiers: [{id, provider, model, tags}]`. `models.s2.default` names the tier used when nothing else says (default: the first); `models.s2.routing` names the tier of each job:

| Key | Job | Default |
|---|---|---|
| `render` | The synchronous render of a turn | `default` |
| `escalate_to` | The tier a render is upgraded to when an escalation trigger fires; it must rank above the render tier | None: without it no render is upgraded |
| `offscreen` | Offscreen narration | `render` |
| `autonomous` | Autonomous NPC dialogue | `render` |

A single model for S2 (`models.s2: {provider, model}`, or one `ModelPort` handed to `createEngine`) is one tier named `only`. A role without a model, or switched to the rule backend, has no tier at all.

The router does not choose between S1 and S2 for a render: a render is S2, or the rule backend. What it chooses is **which S2 tier** serves the turn, and what the turn may spend. It writes the decision as `route.decided` before the render call:

```
route.decided {
  appraise: { backend: "llm", slot: "s1", model } | { backend: "rule" },
  render:   { backend: "llm", slot: "s2", tier, model } | { backend: "rule" },
  triggers: [...],                          // escalation triggers that fired
  escalated?: true,                         // the render runs on `escalate_to` because a trigger fired and the budget allowed it
  budget: { s1Calls, s2CallsByTier },       // what the turn is entitled to: 0 or 1 S1 call, one S2 call on the named tier
  degraded?: [...]                          // degradation actions taken for this turn, in order: the per-turn caps first (`plan`), then the escalation budget
}
```

`route.decided` is the *decision*; it is authoritative for replay. When the call it names then fails and falls back to the rule backend, the deviation is its own event (`runtime.fallback_used`) and the decision is left as written ([Appendix D](#appendix-d-replay-semantics)).

### 17.2 Escalation triggers

Configured by policy `router.triggers`; all are enabled when a trigger is not mentioned. Satisfying any one upgrades the render from its tier to `models.s2.routing.escalate_to`, if the budget allows ([Section 17.3](#173-budget)).

| Trigger | Parameters |
|---|---|
| `anchor_near` | No more than N scenes until deadline |
| `secret_topic` | Appraisal `tags` intersect **locked** secret tags on the addressee (`characters/<id>/secrets.yaml`, secrets not yet in `unlockedSecrets`), **or** literal tag `secret` |
| `mood_spike` | On track `track` (default `mood`): `\|Δtrack\| ≥ a` or `\|track value\| ≥ b` using spike inputs from that track |
| `tier_change` | Any track crosses a tier boundary |
| `contradiction` | Appraisal `claims` and memory `claims` share subject and predicate but differ in object |
| `ambiguity` | `type == other`; or `sincerity < 0.3` with a positive event type; or `input_class == injection_suspect` and `type != insincere_speech` |
| `field_high` | An L2 or higher field applies this turn |
| `sidenote` | A sidenote is received this turn |
| `scene_first` | First turn of the scene |

Triggers need no model: they are evaluated on the appraisal, which the rule backend produces as well. A turn whose render is on the rule backend has nothing to upgrade, so its `triggers` are recorded and its `escalated` is absent.

### 17.3 Budget

Configured by policy `router.budget`:

```
{syncCallsPerTurn: 2, s1PerTurn?, s2PerTurn: 1, s2PerTurnByTier?: {<tier>: n}, s2Ratio, s2ReservedForAnchors, sceneS2Pool?, maxOutputTokens: {s1, s2}}
```

| Key | Meaning |
|---|---|
| `syncCallsPerTurn` | Model calls a turn may make before the player sees a reply: at most one S1 and one S2. A turn that would exceed it gives way as `router.degrade` says |
| `s1PerTurn` | S1 calls per turn; `0` serves the S1 role with the rule backend |
| `s2PerTurn`, `s2PerTurnByTier` | S2 calls per turn for a tier without an entry in the table / for each tier id; `0` disables the tier |
| `s2Ratio` | Share of turns that may run above the default tier |
| `s2ReservedForAnchors` | Share of the scene pool reserved for `anchor_near` escalations while the pool still has room |
| `sceneS2Pool` | Above-default-tier S2 calls a scene may spend (shared pool for renders and side jobs; default derived from `s2Ratio`). When the pool is **exhausted**, anchor-triggered escalations degrade like any other escalation — reserved slots apply only while budget remains ([Section 14](#14-multi-character-orchestration)) |
| `maxOutputTokens` | `s1` and `s2` caps; `s2` is one number for every tier or `{<tier>: n}` per tier |

### 17.4 Degradation

When a budget is exceeded, execute in the order listed in policy `router.degrade`. Actions:

- `s2_tier_down`: serve the render from the tier below instead (an escalated render falls back to the render tier; a tier whose per-turn cap is 0 gives way to the next lower tier)
- `s2_to_rule`: serve the render on the rule backend instead of a model
- `s1_to_rule`: serve `appraise` on the rule backend instead of a model
- `defer_reflection`: defer reflection
- `skip_offscreen_narrate`: skip offscreen narration
- `skip_autonomous`: skip autonomous NPC dialogue

Of `s2_tier_down` and `s2_to_rule` the one listed first resolves an escalation that is not affordable. There is no action that lets S1 write prose: S1 never renders.

Each degradation step writes one `budget.degraded` event with `{kind_detail, action, degraded, from, to, reason}`: `action` is the step taken (one of the names above); `kind_detail` says where the router took it (`plan` before the turn, `route` while choosing the render, `side_job` for the other model calls); `degraded` is `[action]`, which the timeline accumulates in the budget state; `reason` names the limit that forced the step. For tiers, `from` and `to` are tier ids; when a role moves to the rule backend `to` is `rule`; for a skipped side job `to` is `skipped`, and for a deferred reflection `deferred`. Degradation changes what the *next* decisions can use; it does not change the runtime mode (a budget that ends does not switch the engine to rules for good).

### 17.5 Prompt segments

| Segment | Content | Cache breakpoint |
|---|---|---|
| Static | World rules, **`always` knowledge bodies**, identity, constraint set, voice | 1st |
| Semi-static | Relationship summaries, long-term memory summaries, `on-demand` index; updated once per scene | 2nd |
| Dynamic | Tier labels, field effects, `when` knowledge, retrieval results, sidenotes | — |
| History (after dynamic) | Last K dialogue turns (`render.recentTurns`, default 12) as a separate history message block after the dynamic system segment (see [architecture.md 4.3](./architecture.md#43-turn-pipeline-per-sceneturn)) | — |

Cache breakpoints are passed to the model provider via the AI SDK `providerOptions`.

## 18. Dice and checks

| Item | Spec |
|---|---|
| Expression | `NdM[kh\|klK][±C]`, e.g. `2d20kh1+5` |
| Randomness | Check rolls use RNG key `check:<turnId>` (replay-stable per turn) |
| Check | `check({expr, dc, advantage, disadvantage})`. Advantage and disadvantage cancel when both apply; result is written to `check.rolled` as `{id, expr, rolls[], kept?, modifier, total, dc, success, margin, advantage?, disadvantage?, skill?, actor?, target?}` |
| Reference | In CEL, read check results via `check.success`, `check.total`, `check.margin` |

## 19. Policies and presets

### 19.1 Policy keys

| Key | Content |
|---|---|
| `schema.extend` | Extend character, world, and event fields |
| `events.types` | Event set and per-type `positive` flag |
| `tracks` / `rules` | Numeric tracks and rules ([Section 7](#7-rules-and-expressions)) |
| `intent.types` / `intent_rules` | Intent types and intent scoring rules |
| `input.response` / `safety` | Input class responses; safety classification |
| `appraise.*` | Rule-backend appraisal: `patterns`, `fallback`, `commands`, `inputClass` ([Appendix C.2](#c2-appraisal-and-classification)) |
| `fields.grants` / `fields.caps` | Field grants and numeric caps |
| `memory.*` | Retrieval weights, K, forgetting, distortion, propagation; `memory.writing` for how memories are written, narration included ([Section 9.1](#91-memory-entries)) |
| `reflection.*` | `accept` (rules for accepting proposals), `backend`, `summaryTemplate` |
| `characters.lod` | Level of detail and promotion rules |
| `offscreen.*` | `fidelity`; `narrateTemplate` for the rule backend |
| `scene.turnTaking` / `scene.autonomous` | Turn taking; autonomous NPC dialogue, with `rules` for the rule backend |
| `router.*` | Escalation triggers, budget, degradation ([Section 17](#17-routing-budget-s2-tiers-and-caching)) |
| `render.*` | `retryOnMismatch`, recent dialogue turn count K; rule backend `layers` and `fallback` ([Appendix C.3](#c3-render)) |
| `cues.types` | Cue types |
| `choices` | Player choices; rule backend `rules` ([Appendix C.4](#c4-choices)) |
| `timeline.carry` / `timeline.allowRewind` | Carry set; whether rewind is allowed |
| `visibility.rules` | Visibility rules |
| `checks` | Check rules |

### 19.2 Presets

A preset is a directory or npm package containing `preset.yaml` (fields `id`, `extends[]`, `policies[]`), templates, knowledge documents, and rule functions.

### 19.3 Model configuration

Models are optional. A role (S1, S2) that has a model runs on it; a role without one runs on the rule backend, and a game with no `models` section plays entirely on rules. Example `animae.yaml`:

```yaml
preset: "@animae/preset-dnd"
seed: 42
mode: llm                        # llm | hybrid | rule
models:
  s1: { provider: anthropic, model: claude-haiku-5-5 }        # S1: structured judgment
  s2:                                                          # S2: free-text generation, in tiers
    default: standard
    tiers:
      - { id: standard, provider: anthropic, model: claude-sonnet-5-5 }
      - { id: premium,  provider: anthropic, model: claude-opus-5-5, tags: [] }
    routing: { render: standard, escalate_to: premium, offscreen: standard, autonomous: standard }
runtime:
  switchAt: turn_boundary        # turn_boundary | immediate
  fallbackOnError: { appraise: true, render: true }
policies: [policies/my-tweaks.yaml]
```

| Key | Meaning |
|---|---|
| `models.s1` | The S1 model: `{provider, model, ...}`, or `{provider: rule}`. Any provider that can return schema-conformant data |
| `models.s2` | The S2 tiers (`default`, `tiers[]`, `routing`; [Section 17.1](#171-s2-tiers-and-routing)), or one model spec, which is a single tier named `only` |
| `mode` | The mode the engine starts in. `llm`: both roles on their models. `rule`: no model call at all. `hybrid`: each role as `appraise.backend` and `render.backend` say. Omitted: a role runs on its model when one is configured, else on the rule backend |
| `appraise.backend`, `render.backend` | `llm` or `rule` for the S1 role (appraise, classify, safety, reflection, entity generation) and for the S2 role (render, offscreen narration, autonomous dialogue); they override `mode` |
| `runtime.switchAt` | When a requested mode change takes effect: `turn_boundary` (default) or `immediate` |
| `runtime.fallbackOnError` | Per phase (`appraise`, `render`, `reflection`, `entity`, `memoryWrite`, `offscreen`, `autonomous`), `true` serves a failed model call with the rule backend and writes `runtime.fallback_used`; `false` (default) fails the call |

Asking for `llm` on a role that has no model is a configuration error. `createEngine({ mode })` overrides all of the above, and `createEngine({ models })` supplies ports in place of `animae.yaml` models.

Each `ModelSpec` may set optional `timeoutMs` (positive integer, max 3_600_000). When omitted, defaults are 120_000 ms for remote providers and 600_000 ms for `ollama`. Non-streaming calls use a total wall-clock limit; streaming uses the same value for first-chunk and idle-chunk timeouts (steady output is not capped by total duration). Classified failures include `MODEL_TIMEOUT`, `MODEL_UNREACHABLE`, `MODEL_HTTP`, and `MODEL_EMPTY` (see model module docs); each of them is eligible for the rule fall back when `runtime.fallbackOnError` allows it.

### 19.4 `@animae/preset-base`

**Tracks**

| Track | Range | Initial | Tiers (lower bound) | Hysteresis | Decay |
|---|---|---|---|---|---|
| `affinity` | 0–100 | 50 | distant 0 · cool 20 · neutral 40 · close 60 · devoted 80 | ±3 | none |
| `trust` | 0–100 | 50 | wary 0 · doubtful 20 · neutral 40 · trusting 60 · confiding 80 | ±3 | none |
| `mood` | -100–100 | 0 | — | — | 10% per hour toward 0 |

**Event set and base deltas** (in order: affinity / trust / mood)

| Event | Δ | Event | Δ |
|---|---|---|---|
| `care` | +4 / +2 / +10 | `lie_exposed` | -4 / -10 / -15 |
| `praise` | +3 / 0 / +8 | `insincere_speech` | 0 / -3 / -5 |
| `gift` | +4 / +1 / +10 | `boundary_push` | -4 / -4 / -15 |
| `request` | 0 / 0 / 0 | `insult` | -6 / -3 / -20 |
| `promise_kept` | +2 / +6 / +5 | `apology` | +1 / +2 / +5 |
| `promise_broken` | -3 / -8 / -10 | `shared_experience` | +3 / +3 / +8 |
| `disclosure` | +2 / +5 / +5 | `meta_probe` | 0 / -1 / -3 |
| `smalltalk` | +1 / 0 / +2 | `other` | 0 / 0 / 0 |

**Numeric rules**: `marginal.k = 0.5`, `halfLifeHours = 24`; `turn_cap`: affinity 8, trust 8, mood 20.

**Intent**: types `respond`, `comply`, `refuse`, `negotiate`, `deflect`. Scoring rules, in order:

1. `refuse`: event `tags` intersect `bottom_lines` with hardness `hard`
2. `deflect`: `input_class` is not `normal`
3. `negotiate`: `type == request` and `trust < 40`
4. `comply`: `type == request`
5. `respond`: none of the above

**Input response**: `injection_suspect` emits an `insincere_speech` event with intent `deflect`; `meta_probe` emits a `meta_probe` event with intent `deflect`.

**Other policies**

| Policy | Value |
|---|---|
| Safety | `safety.enabled: false` |
| Fields | `fields.grants: [{holder: "true", source: "true", maxLevel: L4}]`; `fields.caps`: `salience.boost ≤ 0.4`, `event_prob ±0.3`, `track_offset ±20` |
| Memory | Retrieval weights per [Section 9.3](#93-retrieval) with **`vector: 0`** (opt-in vector blend); K = 8; forgetting, distortion, and propagation all off; `memory.writing: {backend: rule, template: "{{text}}", narration: none}` |
| Reflection | `reflection.accept` uses default rules from [Section 9.7](#97-reflection) |
| LOD | `extra → supporting`: `interactions >= 3 \|\| 'named' in tags`; `supporting → principal`: referenced by an anchor, or `interactions >= 15` |
| Offscreen | `offscreen.fidelity: rule` |
| Scene | `scene.turnTaking: addressed`; `scene.autonomous.maxExchangesPerPlayerTurn: 0` |
| Routing | All triggers enabled; parameters `anchor_near N=1`, `mood_spike a=30 b=80` |
| Budget | `syncCallsPerTurn 2`, `s1PerTurn 1`, `s2PerTurn 1`, `s2Ratio 0.15`, `s2ReservedForAnchors 0.03`, `maxOutputTokens s1 400 / s2 800` |
| Degradation | `router.degrade`: `[s2_tier_down, s2_to_rule, s1_to_rule, defer_reflection, skip_offscreen_narrate, skip_autonomous]` |
| Render | `render.retryOnMismatch: 0`; recent dialogue turns K = 12 |
| Cues | `cues.types`: `expression{name}`, `action{name}`, `sfx{name}` |
| Choices | `choices.enabled: false`; `choices.rules` holds five quick replies (comfort, ask for help, small talk, praise, apologize) for games that enable choices |
| Rule backend | `appraise.patterns`: twelve English phrase patterns (insult, lie exposed, boundary push, apology, promise kept, gift, praise, disclosure, care, shared experience, request, small talk), `appraise.commands` (`thanks`, `sorry`, `help`, `chat`, `confide`), `appraise.fallback` `other` 0.3 / 0.5. `render.layers`: one utterance layer per forced intent (`refuse`, `deflect`, `negotiate`, `comply`), warm and cold replies by the sign and intensity of the event, a catch-all `respond`, plus three narration layers (scene opening, an intense beat, a scene break on a later day); `render.fallback`. Every text is a string-table key (`$t:base.…`); the package ships the English table ([Appendix C](#appendix-c-rule-backend-design)) |
| Timeline | `timeline.allowRewind: true`; `timeline.carry: []` |
| Visibility | `author` and `gm` can see everything; `player` can only see speech, narration and choices in `events` (kinds `utterance`, `narration`, `choice.offered`, `choice.taken`, `input.received`), and entries in `world/vars` tagged `public`; `npc:<id>` can only see its own self-view |

### 19.5 `@animae/preset-dnd`

`extends: ["@animae/preset-base"]`. Covers the social and exploration subset of SRD 5.2.1; no combat rules.

**Abilities**

- Six abilities STR, DEX, CON, INT, WIS, CHA, scores 1–30; modifier is `floor((score - 10) / 2)`.
- Character `traits` extended to `{abilities, level, proficiencies[]}`.
- Proficiency bonus by level: levels 1–4 +2, 5–8 +3, 9–12 +4, 13–16 +5, 17–20 +6.

**Skills**: the 18 SRD skills each bind to one ability. Social skills include Insight (WIS), Deception (CHA), Intimidation (CHA), Persuasion (CHA), Performance (CHA).

**Checks**: `1d20 + ability modifier + proficiency bonus (if proficient)`; success when result ≥ DC.

**Attitude mapping**

| Affinity tier | Attitude | Social check |
|---|---|---|
| distant, cool | Hostile | Disadvantage |
| neutral | Indifferent | Normal |
| close, devoted | Friendly | Advantage |

**Influence checks**

- **Trigger**: when `appraise.approach` is `persuasion`, `deception`, `intimidation`, or `performance`, roll one check. DC is the greater of 15 and the NPC's Intelligence score.
- **Success**: the event applies at its original type. On successful `deception`, the event is additionally tagged `deceived`; if later exposed, it becomes `lie_exposed`. On successful `intimidation`, also apply affinity -2, trust -2.
- **Failure**: `deception` and `intimidation` downgrade to `insincere_speech`; `persuasion` and `performance` downgrade to `smalltalk`.

**Insight contest**: when an NPC's intent carries the `lie` tag, the player may initiate an Insight check with DC `8 + NPC Deception modifier`. On success, write an `info_arrival` event whose content is that the other party is lying.

**Exploration**: on successful Investigation or Perception checks, unlock knowledge documents whose `when` conditions reference `check.success`, and write an `info_arrival` event.

**Conditions** (mapped to fields)

| Condition | Level | Effect |
|---|---|---|
| Charmed | L2 on charmer | Single field on the **charmer** (`holder: character`): L2 `check_mod` advantage on persuasion/deception/intimidation/performance and `intent_forbid: ["hostile"]` |
| Frightened | L1 | Id `dnd-frightened-<subject>[-<source>]`; `holder: { kind: character, ref: <subject> }` (the frightened character; the fear source only distinguishes concurrent sources); L1 `check_mod: { "*": { advantage: "disadvantage" } }` while the field is active. "Source visible" is not modelled: the host removes the field when the source is out of sight |
| Poisoned | L1 | All ability checks are at disadvantage |
| Exhaustion | L1 | -2 on all d20 checks per level |

**Rest**: short rest advances world time by 60 minutes; long rest by 480 minutes and removes 1 level of Exhaustion.

**Attribution**: distributions of this preset must include:

> This work includes material from the System Reference Document 5.2.1 ("SRD 5.2.1") by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.

### 19.6 `@animae/preset-rule`

`extends: ["@animae/preset-base"]`. What a game needs to play with no model at all (`mode: rule`), and the content the rule backend falls back to when a model call fails. The base preset already carries the appraisal patterns, utterance and narration layers; this preset adds:

| Policy | Value |
|---|---|
| Choices | `choices.enabled: true`, `count: 3`. Without a model free text is only keyword-matched, so quick replies are the primary way to play |
| Commands | `appraise.commands` gains `comfort`, `gift`, `insult`, `threaten`, `greet` |
| Memory | `memory.writing.importanceByEventType` and `valenceByEventType` for every event type of the base preset |
| Offscreen | `offscreen.narrateTemplate`: one line for a quiet location |
| Autonomous | `scene.autonomous.rules`: idle lines for exchanges between characters (a game raises `maxExchangesPerPlayerTurn` to let them happen) |

Every text is a string-table key (`$t:rule.…`). The package ships the English table; a game in another language supplies the same keys in its own `locales/<locale>/strings.yaml`, which overrides these ([i18n guide](./i18n.md)).

## 20. Interfaces

### 20.1 TypeScript API

Normative source: `packages/engine/src/api.ts` (signatures below are abbreviated).

```ts
function createEngine(opts: CreateEngineOptions): Promise<Engine>;

interface CreateEngineOptions {
  root: string;
  models?: EngineModels;              // S1 port + S2 port or tier set; missing role → rule backend
  mode?: RuntimeModePreset | RuntimeModeRequest;
  modeSource?: { reason: ModeChangeReason; trigger?: string };
  modelMode?: "live" | "record" | "replay";
  ports?: { storage?: StoragePort; embedding?: EmbeddingPort; image?: ImagePort };
  seed?: number;
  presets?: PresetBundle[];
  mods?: ModSelection;
  modBundles?: ModBundle[];
  i18n?: Partial<I18nConfig>;
  modelCallLog?: boolean | ModelCallLogOptions | ModelCallLog;
  now?: () => Date;
  sessionId?: string;
}

interface Engine {
  world: { now(): WorldTime; advance(by: Duration | { to: WorldTime }): Promise<EngineEvent[]>; set(path, value): Promise<EngineEvent>; move(who, location): Promise<EngineEvent> };
  scene: { start(...): Promise<SceneId>; turn({ sceneId, actor, text, addressee?, choiceId?, outputLocale? }): AsyncIterable<TurnChunk>; end(sceneId): Promise<SceneReport>; active(): ActiveScene | null };
  entities: { generate(...); promote(...); setAlias(...); resolve(...); spawn(...); retire(...); generateFromBrief(...) };
  setAlias / resolveEntity / spawnEntity;  // aliases of entities.*
  fields: { declare(f): void; grant(f): Promise<LedgerEntry>; revoke(id): Promise<void> };
  director: { sidenote(...): Promise<void>; invokeException(...): Promise<LedgerEntry> };
  timeline: { current(); save(); load(); rewind(); branches(); switch(); diff(); prune(); export(); import(); replay(); saves(); events(opts?) };
  rules: { register(name, fn): void };
  hooks: { register(stage, fn): void };
  introspect: { registerViewer(v): void };
  query(viewer, path): unknown;           // sync; no lazy catch-up
  queryAsync(viewer, path): Promise<unknown>;
  grant / revoke: Promise<void>;
  explain(turnId, viewer): Explanation;
  on(kind, handler): () => void;
  purge(...): Promise<void>;
  importCard / exportCard: Promise<string>;
  reload(): Promise<{ ok; errors; warnings }>;
  setUiLocale(locale): void;
  display: { resolve(value, opts?); entityDisplayName(id, opts?) };
  info(): { root, preset?, language, locale, promptLocale, outputLocale, contentLocale, branch, sessionId, models, mode, modelMode };
  runtime: EngineRuntime;
  modelCallLog?: ModelCallLog;
  gallery: GalleryService;
  mods(): { mods; drift; driftMessage?; provenance };
  close(): Promise<void>;
}

// which backend serves each role; S1 and S2 are roles, `llm` and `rule` are backends
interface RuntimeMode { appraise: "llm" | "rule"; render: "llm" | "rule"; s2Tier?: string }
type RuntimeModePreset = "full" | "judge-only" | "narrate-only" | "rule";   // llm/llm, llm/rule, rule/llm, rule/rule
type RuntimeModeRequest = Partial<RuntimeMode>;                              // omitted roles keep their backend
interface ModelsInfo {          // safe to show in a UI
  s1: string; s2: string;       // model ids, or "rule"
  s1Llm: boolean;
  s2Tiers: { id: string; model: string; tags: readonly string[] }[];
  s2Default?: string; s2Escalate?: string;
}

type TurnChunk =
  | { type: "text"; text: string; speaker?: string; autonomous?: boolean; newUtterance?: boolean }
  | { type: "narration"; text: string; style?: "normal" | "scene_break"; newParagraph?: boolean }
  | { type: "cue"; cue: { type: string; args: Record<string, unknown> }; at: number; speaker?: string }
  | { type: "choices"; choices: { id: string; text: string; expected_event_type: string; tags: string[] }[] }
  | { type: "reset"; reason: "fallback" | "retry" }
  | { type: "done"; turnId: TurnId; events: EventId[]; speaker?: string };

```

Consecutive `text` chunks from the same speaker between two `done` chunks are streaming fragments of one utterance unless `newUtterance` is set. Consumers must append fragments into a single transcript row and emit one stream start/end pair per utterance.

`narration` chunks follow the same rule for paragraphs: consecutive `narration` chunks are fragments of one paragraph, appended to it, unless `newParagraph` is set. A paragraph ends when another paragraph, a `text`, a `cue`, `choices` or `done` follows. `style` is the style of the paragraph the fragment belongs to (`normal` when absent). Narration streams ahead of the character's `text`, and a turn without narration sends no `narration` chunk.

A `reset` chunk tells the consumer to discard every `text`, `narration`, `cue` and `choices` chunk it has received for the turn in flight since the player's own line (which stays), because the engine is replacing that output ([Section 8](#8-cognitive-pipeline), *Stream resets*). The replacement follows. A `reset` never follows `done`.

```ts
interface ModelPort {
  id: string;
  tags?: readonly string[];                               // capability tags, CEL `model.tags`
  object<T>(req: ModelRequest & { schema: ZodType<T> }): Promise<T>;                    // S1: structured judgment
  stream(req: ModelRequest & { schema: ZodType<unknown> }): AsyncIterable<StreamPart>;  // S2: free-text generation
}
interface ModelRequest {
  label: string; segments: PromptSegments; tools?: ToolDef[]; maxOutputTokens: number; /* temperature, seed, ... */
  purpose?: ModelPurpose;                  // what the call is for; ignored by LLM ports, the rule backend dispatches on it
  context?: Readonly<ModelCallContext>;    // structured inputs for backends that do not read the prompt; never part of a recording key
}
type ModelPurpose = "appraise" | "classify" | "safety" | "reflection" | "entity" | "memory-write" | "gallery-brief"   // object(): S1
                  | "render" | "offscreen" | "autonomous";                                                          // stream(): S2
```

`purpose` and `context` are optional, so every existing `ModelPort` keeps working unchanged. The engine always sets them. `ModelCallContext` carries the call's CEL variables (`self`, `other`, `actor`, `event`, `scene`, `world`, `time`, `tracks`, `tiers`, `fields`, `check`, `input`, `intent`), the identity of the call (turn id, the `input.received` event id), `extra` data for the purpose, and `rng()`, the seeded random source that is the only randomness a rule backend may use.

### 20.2 JSON-RPC sidecar

- Start command: `animae serve --stdio --root <dir>`.
- Method names correspond one-to-one with API paths, e.g. `scene.turn`, `timeline.rewind`, `query` (uses `queryAsync` semantics). Full method list: [rpc-reference.md](./rpc-reference.md).
- **Blocked** (`-32601`): `close`, `rules.register`, `hooks.register`, `introspect.registerViewer`.
- Streaming results are pushed via `turn.chunk` notifications with parameters `{requestId, chunk}`; `chunk` is a `TurnChunk`, `narration` and `reset` included.
- Engine events are pushed via `event` notifications; call `subscribe({kinds})` first to subscribe.
- `runtime.mode` returns `{mode, pending, switchAt, models}`. `runtime.setMode({mode, trigger?})` takes a preset name or a `{appraise?, render?, s2Tier?}` object and returns `{before, after, pending}`; it is not behind the turn lock, so a switch asked for while a turn streams is queued and `pending` is `true`. Errors carry `data.code`: `MODE_INVALID`, `MODE_UNAVAILABLE` (the role has no model), `MODE_UNKNOWN_TIER`.

### 20.3 CLI

Normative help text: `packages/cli/src/args.ts` (`helpText()`).

| Command | Function |
|---|---|
| `init <dir> [--preset <id>]` | Create data root skeleton |
| `validate [--mods a,b] [--locale <tag>] [--mode <mode>]` | Load/validate authored data + policy (+ mods, UI strings); `--mode` adds rule-backend playability checks |
| `mods list` | List mods under `mods/` |
| `mods validate [--mods a,b]` | Validate mod manifests and dependency order |
| `mods explain <path>` | Show which layer provided an authored path |
| `run [--scene] [--with] [--viewer] [--theme] [--plain]` | Interactive TUI or `--plain` REPL |
| `inspect <path> [--viewer] [--kind]` | Query state (`queryAsync` for player paths); `--kind` filters `events` |
| `timeline <sub> ...` | Timeline list/save/load/rewind/switch/diff/prune/export/import/replay |
| `import-card <file>` / `export-card <id>` | Character card import/export |
| `serve --stdio` | JSON-RPC sidecar |
| `gallery <sub> ...` | Gallery list/show/capture/render (headless) |
| `i18n check [--pack] \| pseudo \| extract` | Locale pack / prompt hygiene |

**Global flags:** `--root`, `--model-mode live|record|replay`, `--mode full|judge-only|narrate-only|rule`, `--seed`, `--lang <locale>`, `--image-command`, `--image-command-arg` (repeatable), `--version`, `--help`.

## 21. Terminal UI `@animae/tui`

### 21.1 Technical foundation

| Item | Spec |
|---|---|
| Renderer | Ink 8 (React) |
| Runtime | Node ≥ 24 and Bun; may be bundled into the `animae` executable |
| Connection | Calls the `Engine` instance in-process |
| Data reads | Panels via `engine.queryAsync(viewer, path)` when available (else `query`); default viewer `player` |
| Character width | Unicode display width; correct handling of East Asian wide and fullwidth characters |
| Terminal size | Dual-column layout when width ≥ 100; single column at 80–99 with sidebar as overlay; prompt to enlarge terminal below 80×24 |

### 21.2 Default layout

```
┌ Header: world time · location · chapter · branch ─────────────────────────────┐
│ Transcript (dialogue, 70%)            │ SidePanel (30%)                     │
│  Name [expression]: line (typewriter)   │  Participants and visible tracks/tiers │
│    narration paragraph (indented)     │  Active fields (if visible)         │
│  ──────── scene break ────────        │  Current anchor/beat (if visible)     │
├───────────────────────────────────────┴───────────────────────────────────────┤
│ ChoiceMenu (when choices exist)                                               │
│ InputLine: > enter line or :command                                           │
└ Footer: key hints · mode [S1:LLM S2:std] · budget usage ──────────────────────┘
```

The footer's mode indicator names the backend of each role: `[RULE]` when both run on rules, otherwise `[S1:LLM S2:<tier>]`, `[S1:LLM S2:RULE]` or `[S1:RULE S2:<tier>]` (a single unnamed S2 model shows as `LLM`). A change that is queued for the turn boundary shows next to it (`→ [RULE]`). When the router served a turn from a higher tier than the mode selects, the footer shows the tier that answered.

### 21.3 Overlays and keys

| Key | Action |
|---|---|
| Enter | Submit input |
| ↑ / ↓, 1–9 | Move in choice menu or select directly |
| Any non-Ctrl key (during typewriter) | Skip typewriter for current line (global handler; navigation keys still pass through) |
| PageUp / PageDown | Scroll focused transcript or side panel |
| Ctrl+P / `p` | Command palette |
| Ctrl+M / `m` | Toggle mouse support |
| Tab | Switch focus between Transcript and SidePanel; focused region scrolls |
| F1 | Help |
| F2 | Event log EventLog (filter by kind) |
| F3 | Timeline browser TimelineBrowser: branch tree, save slots, switch, rewind |
| F4 | explain for previous turn |
| F5 | State inspector Inspector, interactive `query` |
| F6 | Mode panel: the current mode, the presets (`full`, `judge-only`, `narrate-only`, `rule`) and the S2 tiers; choosing one switches the mode. A switch made while a turn runs says that it takes effect after the turn. Entries a role has no model for are shown as unavailable |
| Ctrl+S / Ctrl+L | Save / load |
| Ctrl+Z | Rewind to previous turn: confirm, then fork new branch |
| Esc | Close current overlay |
| Ctrl+C | Close engine and exit |

Overlay content is filtered by the current viewer.

### 21.4 Cue and narration rendering

- Each cue type has a `CueRenderer`, fired aligned to `at` offset and typewriter progress.
- Three built-in renderers:

  | cue type | Rendering |
  |---|---|
  | `expression` | Show `[name]` after character name |
  | `action` | Insert italic, dim narration line |
  | `sfx` | Display as `♪ name`; terminal bell when theme `bell: true` |

- Cue types without a registered renderer are not shown; they are recorded only in the event log.

**Narration** is rendered by the Transcript itself, not by cue renderers:

| style | Rendering |
|---|---|
| `normal` | One or more indented lines with no speaker name, in theme color `narration` (gray when the theme has none). Consecutive paragraphs are separated by a blank line |
| `scene_break` | A horizontal rule across the transcript (`─`), set off by a blank line, with the paragraph's text, if any, indented under it |

The typewriter types narration like dialogue, and any key during it shows the full text at once. A `reset` chunk removes the rows of the turn in flight except the player's own line, then the replacement streams. When the mode is switched, and when a model call falls back to the rule backend, the Transcript shows a system line saying so.

### 21.5 Theme

Theme file is YAML, via `--theme` or `runTui({theme})`:

```yaml
colors: { primary: cyan, npc: magenta, player: green, narration: gray, warning: yellow }
border: round            # single | double | round | bold | none
typewriter: { charsPerSecond: 60, enabled: true }
sidePanel: { width: 30, show: [participants, tracks, fields, anchor] }
bell: false
```

### 21.6 API

```ts
import { runTui, defaultLayout, components, hooks } from "@animae/tui";

runTui(opts: {
  engine: Engine;
  viewer?: Viewer;                                  // default "player"
  scene: { location: string; participants: string[] } | { sceneId: SceneId };
  actor?: string;                                   // default "player"
  layout?: React.ComponentType<LayoutProps>;        // default defaultLayout
  theme?: Theme | string;
  cueRenderers?: Record<string, CueRenderer>;
  keymap?: Partial<Keymap>;
}): Promise<void>;

type CueRenderer = (cue: { type: string; args: Record<string, unknown> }, ctx: CueCtx) => React.ReactNode | null;
```

| Component `components` | Role |
|---|---|
| `Header`, `Footer` | Status bars |
| `Transcript` | Dialogue and narration stream with `Typewriter` and cue rendering |
| `Typewriter` | Character-by-character text with skip support |
| `ChoiceMenu` | Player choice menu |
| `InputLine` | Input line with history and `:` commands |
| `SidePanel`, `TrackBar`, `FieldList` | Sidebar, track bars, field list |
| `EventLog`, `TimelineBrowser`, `ExplainView`, `Inspector`, `ModePanel` | Overlay views |
| `Overlay` | Overlay container |

| Hook `hooks` | Role |
|---|---|
| `useEngine()` | Current `Engine` instance |
| `useTurn()` | Submit input; subscribe to current turn `TurnChunk` stream |
| `useQuery(path)` | `queryAsync` as current viewer; keeps previous data while refreshing |
| `useEvents(kinds)` | Subscribe to engine events |
| `useRuntimeMode()` | Current runtime mode, the mode queued for the turn boundary, the configured models and `switchAt`; `undefined` for an engine without `runtime` |
| `useTheme()` | Current theme |
| `useKeymap()` | Read and register key bindings |

Upper layers may replace the entire `layout`, compose components, register cue renderers, or override key bindings.

Hosts that draw their own status line reuse `modeIndicator(mode, models, pending?)`, which formats the footer badge (`[S1:LLM S2:std]`, `[RULE]`; a change waiting for the turn boundary is appended as `→ [next]`).

## 22. Event type catalog

| Group | Events |
|---|---|
| Input | `input.received`, `input.classified`, `appraisal`, `safety.flagged` |
| Checks | `check.rolled` |
| Tracks | `track.delta`, `tier.changed` |
| Fields | `field.applied`, `field.rejected`, `field.cost_due`, `field.cost_settled` |
| Intent and generation | `intent.decided`, `intent.mismatch`, `route.decided`, `utterance` (optional `retrieval[]` log), `narration`, `choice.offered`, `choice.taken`, `choice.filtered` |
| Memory | `memory.written`, `memory.distorted`, `memory.propagated`, `reflection.proposed`, `reflection.accepted`, `reflection.rejected` |
| Entities | `entity.generate`, `entity.created`, `entity.spawned`, `entity.retired`, `entity.alias_set`, `character.promoted`, `character.secret_unlocked` |
| World | `world.var_set`, `time.advanced`, `schedule.fired`, `longevent.phase`, `longevent.interrupted`, `offscreen.simulated` |
| Director | `anchor.progress`, `anchor.fulfilled`, `anchor.fallback`, `beat.entered`, `beat.exited`, `sidenote.added`, `sidenote.expired`, `sidenote.echoed`, `exception.used` |
| Visibility | `visibility.granted`, `visibility.expired` |
| Timeline | `branch.header`, `branch.forked`, `carry.applied`, `purge.applied` |
| Config and budget | `config.reloaded`, `config.warning`, `config.error`, `budget.degraded` |
| Runtime | `runtime.mode_changed`, `runtime.fallback_used` |
| Gallery | `gallery.unlocked`, `gallery.captured`, `gallery.rendered`, `gallery.removed` |

Payloads of the events that carry the backend, the mode and narration:

| Event | Payload |
|---|---|
| `route.decided` | `{appraise: {backend: "llm", slot: "s1", model} \| {backend: "rule"}, render: {backend: "llm", slot: "s2", tier, model} \| {backend: "rule"}, triggers[], escalated?, budget: {s1Calls, s2CallsByTier}, degraded?[]}`. The decision for the turn, written before the render; authoritative for replay ([Appendix D](#appendix-d-replay-semantics)) |
| `narration` | `{text, style: "normal" \| "scene_break"}`; no speaker. Source `pipeline:render` |
| `runtime.mode_changed` | `{before: RuntimeMode \| null, after: RuntimeMode, reason: "api" \| "config" \| "budget" \| "fallback" \| "cli", trigger?}`; `before` is `null` for the first mode a timeline records. The engine itself writes `config` (mode from `animae.yaml`), `api` (`createEngine({mode})` or `runtime.setMode`) and `cli` (`--mode`); `budget` and `fallback` are for hosts that choose to change the mode in response to those conditions |
| `runtime.fallback_used` | `{phase, from: "llm", to: "rule", error: {code, message}}`; `phase` is one of `appraise`, `render`, `reflection`, `entity`, `memory_write`, `offscreen`, `autonomous`. One model call was served by the rule backend because it failed; the runtime mode is unchanged |
| `budget.degraded` | `{kind_detail, action, degraded, from, to, reason}` ([Section 17.4](#174-degradation)) |

`runtime.mode_changed` and `runtime.fallback_used` are different facts and are never mixed: the first says what the engine was *asked* to run on, the second that one call *could not* run on it.

## 23. Glossary

| Term | Definition |
|---|---|
| Engine | Animae runtime library |
| Mechanism | Capability provided by the engine |
| Policy | Upper-layer configuration of mechanisms |
| Preset | A bundled set of policies, templates, knowledge, and rule functions |
| Data Root | Local directory holding all state |
| Timeline | An append-only event log |
| Branch | A new timeline forked from an event |
| Ancestor Chain | Path from root branch to current branch |
| Save Slot | Pointer to `{branch, eventId}` |
| Rewind | Fork a new branch from a past event |
| Carry Set | Filter for entries copied to a new branch when forking |
| Prune | Delete a branch with no child branches |
| Purge | Physically delete content and redact text in the log |
| Snapshot | State cache used for reconstruction |
| Recording | LLM response stored by request hash |
| Replay | Recompute state from events and recordings |
| Playback | Emit historical output turn by turn |
| Event | One state-change record in the log |
| Because | Field or event id referenced by an event |
| Source | Rule, field, proposal, or external call that produced an event |
| Proposal | Adjudication-pending content from LLM output |
| Adjudicator | Component that turns proposals into events |
| Rule Primitive | Built-in rule building block |
| Rule Function | Synchronous pure function registered by upper layers |
| Stage Hook | Function `(ctx, next, k)` that wraps or replaces a pipeline stage |
| Turn | One input and its processing |
| Scene | Continuous interaction at one location with participants |
| Session | One play period during an engine run |
| WorldTime | `{day, minute}` |
| Calendar | Time units, scene duration, chapter definitions |
| Chapter | Day-range declaration in the calendar |
| Scheduler | Executor for timed and periodic events |
| Long Event | Scheduled item with duration and phases |
| Offscreen Simulation | World advancement when the player is absent |
| Fidelity | Offscreen simulation tier: `none`, `rule`, `narrate`, `full` |
| Lazy Catch-up | Catch up elapsed time when observed |
| Character | Person entity managed by the engine |
| Level of Detail (LOD) | `extra`, `supporting`, `principal` |
| Promotion | Raise a character's level of detail |
| Template | Definition used for dynamic entity generation |
| Identity | Character basics and voice |
| Constraint Set | Motivations, bottom lines, taboos |
| Bottom Line | Constraint entry with hardness |
| Taboo | Forbidden tag |
| Traits | Character attribute dimensions and event coefficients |
| Track | One quantifiable character state |
| Tier | Discrete level on a track |
| Hysteresis | Buffer band for tier changes |
| Marginal Decay | Diminishing returns for repeated events of the same kind |
| Intent | Character's behavioral orientation this turn |
| Memory Entry | One record in character memory |
| Knowledge Doc | Markdown document with frontmatter |
| Injection | Place text into a prompt segment |
| Retrieval | Text matching and scoring |
| Forgetting | Exclude entries from retrieval by retention |
| Distortion | Rewrite instruction attached at retrieval |
| Propagation | Information spread along relationship graph |
| Reflection | S1 proposal at scene end |
| Field | Modifier with level, grant, and ledger |
| Holder | Entity a field is attached to |
| Scope | Range where a field applies |
| Level | Field target layer, L0–L4 |
| Grant | Maximum level allowed for a field |
| Stacking | Merge mode for the same field |
| Cost | Effect settled when a field expires |
| Ledger | View of field-related events |
| Self-view | Character's view of self and world; may be affected by L4 |
| Anchor | Narrative goal with deadline |
| Beat | Narrative phase with enter and exit conditions |
| Sidenote | Runtime prompt injected for a character |
| Exception | Rule bypass with limited uses |
| Viewer | Subject that queries state |
| Visibility | Viewer's read permission on paths |
| Temporary Grant | Visibility grant with TTL |
| Introspection | Query and explain engine state |
| Input Class | `normal`, `injection_suspect`, `meta_probe` |
| Safety Classification | Optional safety category detection |
| S1 | Role: structured judgment. A prompt and a JSON schema go in, schema-conformant data comes out, never free text |
| S2 | Role: free-text generation, in one or more tiers |
| S2 Tier | One entry of `models.s2.tiers[]`: an id, a model and capability tags; tiers form a ladder, cheapest first |
| Backend | What serves a role: `llm` (a `ModelPort`) or `rule` (the rule backend) |
| Rule Backend | Deterministic, token-free counterpart of every model call; answers through the same schemas |
| Runtime Mode | Which backend serves each role right now (`{appraise, render, s2Tier?}`); presets `full`, `judge-only`, `narrate-only`, `rule` |
| Fallback | Serving one failed model call with the rule backend (`runtime.fallback_used`) |
| Template Pool | Weighted list of lines of a rule-backend template layer |
| Narration | Speaker-less text: a scene description, a transition, a sound off stage |
| Scene Break | Narration style that renders as a divider |
| Routing | Choice of the S2 tier that serves a render |
| Escalation Trigger | Condition that upgrades a render to the escalation tier |
| Synchronous Call | Model call that blocks the reply |
| Budget | Caps on calls and tokens |
| Degradation | Ordered handling when budget is exceeded: lower the tier, serve a role on the rule backend, or skip a side job |
| Prompt Segments | Static, semi-static, and dynamic segments |
| Cue | Structured performance tag aligned with text |
| Utterance | One line spoken by a character; never narration |
| Choice | Optional input emitted with generation |
| Dice Expression | `NdM[kh\|klK][±C]` |
| Check | Dice result compared to DC |
| Difficulty Class (DC) | Target value for a check |
| Advantage / Disadvantage | Roll twice, take higher / lower |
| Hot Reload | Reload authored files at turn boundaries |
| Character Card | Import/export package for a character |
| ModelPort | Model invocation interface |
| StoragePort | Storage interface |
| EmbeddingPort | Embedding generation interface |
| Sidecar | Process serving via stdio JSON-RPC |
| TUI (Terminal User Interface) | Terminal play UI from `@animae/tui` |
| Layout | Top-level React component organizing UI |
| Overlay | View above the main UI, e.g. event log, timeline browser |
| Theme | Colors, borders, typewriter, etc. |
| Typewriter | Character-by-character text display |
| Cue Renderer | Function rendering a cue type to the terminal |
| Keymap | Key-to-action map |
| Mode Panel | TUI overlay (F6) that shows and switches the runtime mode |

## 24. CG gallery

Preset and captured illustration slots scoped to the profile (shared across timelines). Authored in `animae.yaml` under `gallery`; optional `ImagePort` generates images off-thread via a FIFO job queue (concurrency 1, pending cap 8). Content **ratings** (CEL `when`, plus `image.tags`) gate list, brief, generate, and serve; preset unlock may occur while a rating is temporarily unavailable. Collection files live under `gallery/collection.json` and `gallery/images/` (atomic writes, corrupt-index recovery, orphan cleanup). Timeline events record unlock/capture/render/remove for export; the collection file is authoritative for unlock state and bytes. Public API: `Engine.gallery` (`GalleryService`); RPC `gallery.*` with `gallery.notice`. Full reference: [gallery.md](./gallery.md).

## Appendix A. S1 and S2 mapping

Which role and backend serves each stage and each model call. `rule` is the rule backend of [Appendix C](#appendix-c-rule-backend-design); a stage that is not in the table is pure rules and never calls a model.

### A.1 Stages

| Stage | Role | Backend | Request schema | Sync | Fallback keyed by |
|---|---|---|---|---|---|
| `classify` | S1 \| rule | part of the `appraise` call | `input_class` field of the appraisal | yes | `appraise` |
| `appraise` | S1 \| rule | `llm` or `rule` | appraisal | yes | `appraise` |
| `check`, `adjudicate`, `applyFields`, `decide`, `route` | none | rules | n/a | n/a | n/a |
| `render` | S2 \| rule | `llm` (tier) or `rule` | render output | yes | `render` |
| `commit`: memory write | S1 \| rule | `llm` or `rule`; the S1 model is asked only when `memory.writing.backend: s1` | `{text, importance, valence}` | no (after the reply) | `memoryWrite` |
| reflection | S1 \| rule | `llm` or `rule` | `{summaries[], goal_changes[], new_claims[]}` | no | `reflection` |
| `entity.generate` | S1 \| rule | `llm` or `rule` | the template's `fields` | no | `entity` |
| offscreen narration | S2 \| rule | `llm` (tier `routing.offscreen`) or `rule` | `{text}` | no | `offscreen` |
| autonomous NPC dialogue | S2 \| rule | `llm` (tier `routing.autonomous`) or `rule` | render output | no | `autonomous` |

### A.2 Model calls

| `purpose` | Role | Served by `ModelPort` method | Rule counterpart |
|---|---|---|---|
| `appraise` | S1 | `object` | `appraise.*` ([C.2](#c2-appraisal-and-classification)) |
| `classify`, `safety` | S1 | `object` | Keyword tables; `safety` answers `none`. The engine asks for both inside `appraise`; the purposes exist for hosts that run them as separate calls |
| `memory-write` | S1 | `object` | `memory.writing` ([C.5](#c5-memory-reflection-entities-offscreen-autonomous)) |
| `reflection` | S1 | `object` | `reflection.summaryTemplate` |
| `entity` | S1 | `object` | Template `defaults` and the seeded rng |
| `gallery-brief` | S1 | `object` | None: a CG brief needs a model. With the role on the rule backend the brief fails with `GALLERY_NO_MODEL` and no image is generated; preset slots still unlock |
| `render` | S2 | `stream` | `render.layers`, `choices.rules` ([C.3](#c3-render), [C.4](#c4-choices)) |
| `offscreen` | S2 | `stream` | `offscreen.narrateTemplate` |
| `autonomous` | S2 | `stream` | `scene.autonomous.rules` |

### A.3 Counts

Synchronous model calls per turn: `full` 2 (one S1, one S2); `judge-only` 1 (S1); `narrate-only` 1 (S2); `rule` 0. The asynchronous calls of a turn run on the roles' current backends and are not counted in the synchronous budget. The S2 tools `search` and `read` exist only for an `llm` render and are not offered to the rule backend.

## Appendix B. Runtime modes and switching

### B.1 Modes

A runtime mode is `{appraise, render, s2Tier?}`: the backend of the S1 role and of the S2 role, and optionally the S2 tier that sync renders start from (it defaults to `models.s2.routing.render`, then `models.s2.default`).

| Preset | `appraise` (S1) | `render` (S2) | Model calls per turn |
|---|---|---|---|
| `full` | llm | llm | 2 |
| `judge-only` | llm | rule | 1 |
| `narrate-only` | rule | llm | 1 |
| `rule` | rule | rule | 0 |

A role can run on `llm` only when a model is configured for it. Asking for `llm` on a role without a model is an error (`MODE_UNAVAILABLE` for a switch, a `MODEL_CONFIG` error at start-up).

### B.2 Initial mode

The engine starts under, in priority order: `createEngine({ mode })` or the CLI's `--mode`; `appraise.backend` and `render.backend` in `animae.yaml`; `mode` in `animae.yaml` (`llm`, `hybrid`, `rule`); otherwise each role on its model when one is configured, else on the rule backend. The first mode a timeline records is announced by a `runtime.mode_changed` event with `before: null`, written together with the first turn (or the first change) so that opening an engine only to read it writes nothing.

### B.3 Switching

`engine.runtime.setMode(preset | {appraise?, render?, s2Tier?}, {reason?, trigger?})` changes which backend serves a role; omitted roles keep their backend. It never interrupts a model call that is in flight, and it never changes a turn that is running: a turn reads the mode once, when it begins, and runs on that snapshot to its end.

| `runtime.switchAt` | Behavior |
|---|---|
| `turn_boundary` (default) | A change requested while a turn is in flight is queued and applied right after that turn, before the next begins. The response says `pending: true`. A further request builds on the queued change (roles it omits keep what the queued change set) and replaces it; a request that ends up at the current mode cancels it. With no turn in flight the change applies at once |
| `immediate` | The change applies at once. A turn already running keeps its snapshot. For tests and CI |

Every applied change writes one `runtime.mode_changed` event. A request for the mode already in force writes nothing.

### B.4 Edge cases

| Situation | Behavior |
|---|---|
| The client disconnects while a turn streams | The turn is discarded as before; nothing of it is committed |
| A switch is requested during `render` | Queued under `turn_boundary`; the render in flight finishes (or fails) on its backend |
| A reflection or other async job is running when the mode changes | It finishes on the backend it started with; jobs that start later use the new mode |
| S1 fails or times out (`runtime.fallbackOnError.appraise: true`) | The rule backend appraises that turn, a `runtime.fallback_used {phase: "appraise"}` is written, and `route.decided.appraise` shows `rule`. The mode is unchanged and the next turn tries the model again |
| S2 fails mid-stream (`fallbackOnError.render: true`) | The consumer receives `{type: "reset", reason: "fallback"}`, the rule backend renders the turn, and the turn commits with `runtime.fallback_used {phase: "render"}`. `route.decided.render` keeps naming the decision (`llm`) |
| A failure with its fall back switched off | The turn fails with the model's error (`MODEL_TIMEOUT`, `MODEL_UNREACHABLE`, `MODEL_HTTP`, `MODEL_EMPTY`, ...) and nothing of it is committed. Aborts and missing recordings are never turned into a fall back |
| The budget is exhausted | `budget.degraded` events and `route.decided` say what was served instead ([Section 17.4](#174-degradation)); the mode is not changed |

## Appendix C. Rule backend design

### C.1 Principles

The rule backend is a `ModelPort` (`RuleModelPort`, id `rule`) that engine code can swap for an LLM port without noticing:

- *Same interfaces.* It answers the request's own zod schema (the schema an LLM answer must satisfy), so an answer has exactly the fields a model's answer has ([I12](#3-engine-invariants)).
- *Deterministic.* It reads no clock and no network and never calls `Math.random`. Every draw comes from `ctx.rng()`, a stream seeded from the timeline seed and the key `rule:<input.received event id>:<scene turn ordinal>:<call key>`. The call key is the purpose (`appraise`, `render`, `memory-write`), or for background jobs one that names them (`reflection:<scene>:<owner>`, `offscreen:<location>:<day>:<minute>`, `generate-brief:...`). The same log gives the same output.
- *Reads data, not prompts.* It works from `ModelRequest.context` (the CEL variable bag of the call plus `input`, `intent`, `call`, `extra`) and from policy. `model.kind` is `rule` and `model.tags` is empty in every expression it evaluates.
- *Degrades, does not fail.* A `when` or `{{ }}` that fails to evaluate counts as false or renders empty and is reported as a warning; a rule-mode game never goes down for a typo in a template. `animae validate --mode rule` finds these before play.

### C.2 Appraisal and classification

The appraisal is derived in priority order, first hit wins:

1. *The choice taken.* A turn started from a choice (`choiceId`) appraises to that choice's own metadata (`expected_event_type`, `tags`, `intensity`, `sincerity`, `approach`; defaults 0.6 and 0.8).
2. *A command.* `/<word> [intensity|tag ...]`. `<word>` is an event type id, or a key of `appraise.commands` that maps a word to one; a number among the arguments is the intensity (`0.8`, `80`, `80%`), the other arguments are tags. Defaults: intensity 0.6, sincerity 0.8.
3. *A pattern.* `appraise.patterns: [{match, flags?, event}]`, the first whose regular expression matches the input (flags default to `i`). `event` is `{type, intensity, sincerity, approach?, tags[]}`.
4. *The fallback.* `appraise.fallback` (default `{type: other, intensity: 0.3, sincerity: 0.5}`).

An event type the policy does not define becomes `other`. `claims` is empty (extracting claims needs judgment), `search_terms` are the (at most five) longest words of the input, found with the platform's word segmenter, so they work for scripts written without spaces. `input_class` comes from the keyword tables (`appraise.inputClass` extends a small English default set with the game's own regular expressions, in any language); commands and choices are `normal`. `safety` is `none`.

### C.3 Render

`render.layers: [{id, when, pool: [{text, weight?, cues?, intent?, style?}]}]` and `render.fallback: {text, cues?, intent?}`.

- *Utterance.* The first layer whose `when` (CEL, default `true`) holds and that is not a narration layer speaks: one pool line is drawn, weighted by `weight` (default 1; every pick consumes one `rng()` draw, even from a pool of one). If no layer matches, `render.fallback` speaks; failing that, the built-in `…`.
- *Narration.* A layer whose pool lines are all `style: narration` (a normal paragraph) or `style: narration_break` (a scene break) is a narration layer. It does not compete for the utterance: every narration layer whose `when` holds adds one paragraph, in layer order. Narration lines carry no cues and no intent.
- *Text.* `text` may contain `{{ CEL }}` placeholders (over the call's variables, for example `input.text`, `event.type`, `self`, `time`), `$t:key` string-table keys and `{{name:<id>}}` entity references. Locale follows the engine's output locale.
- *Cues.* A line's `cues` are `{type, args, at?}`; `at` is clamped to the text length. They pass the same cue validation as a model's, so a cue outside `cues.types` is dropped.
- *Intent.* `intent_realized` is the line's `intent`, else the intent `decide` chose; the rule backend never produces `intent.mismatch` and never retries.
- *Autonomous dialogue* uses `scene.autonomous.rules`, layers of the same shape; without them the exchange is skipped.

### C.4 Choices

`choices.rules: [{id?, when?, text, event_type, tags?, intensity?, sincerity?, approach?}]`: in order, the rules whose `when` holds and whose rendered `text` is not empty, at most `choices.count`. The choice offered has the shape of an LLM choice and carries what it appraises to when taken, so taking it goes through C.2 step 1. Choices appear only when `choices.enabled` is true, and pass `choices.filter` like any others.

### C.5 Memory, reflection, entities, offscreen, autonomous

| Call | Rule counterpart | Without its policy keys |
|---|---|---|
| Memory write | `memory.writing.template` for the text, `importanceByEventType` and `valenceByEventType` for the weights (otherwise the appraised intensity and the sign of the mood change) | The memory text is the utterance |
| Reflection | One summary rendered from `reflection.summaryTemplate`; no goal changes, no claims | No reflection is written |
| `entity.generate` | Field by field: current value, caller's hint, template `defaults` (a list is a pool drawn with the rng), the field's `default`, else a synthesized value | Synthesized values |
| Offscreen narration | `offscreen.narrateTemplate` over `location` and `time` | Nothing is written |
| Autonomous dialogue | `scene.autonomous.rules` | The exchange is skipped |
| S2 tools `search`, `read` | Not offered; a rule render retrieves nothing | n/a |

### C.6 Templates and string tables

Player-facing text in a policy should be a string-table key (`$t:namespace.key`) so a game can ship it in any language; the engine and its presets ship English tables only, and a game overrides or extends them per locale ([i18n guide](./i18n.md)). A literal text is valid and is shown as written.

### C.7 Authoring check

`animae validate --mode rule` reports as errors a rule-mode game that could print only the built-in `…` (no catch-all utterance layer and no `render.fallback`) and string keys that no locale of the chain defines; it warns for features that would be skipped silently (reflection summaries, offscreen traces, autonomous exchanges, choices).

## Appendix D. Replay semantics

Replay follows the log, never the current mode.

1. *Mode tracking.* Replay reads the runtime mode from `runtime.mode_changed` events, so it knows what each turn began under.
2. *`route.decided` is authoritative.* For each turn it names the backend that served each role. A role served by `llm` needs its recording: in replay mode every recording the log refers to (the `recording` key of `appraisal` and `utterance` events whose binding is `llm`) must be present before playback starts, otherwise `timeline.replay` fails with `RECORDING_MISSING` and lists the turn and key of each missing one. A role served by `rule` needs none: its output is recomputed deterministically from the seed and the log.
3. *Fallbacks.* A `runtime.fallback_used` in a turn says that the call of that phase was served by the rule backend although the decision named `llm`; replay recomputes it on rules and does not look for its recording.
4. *Independence from the current mode.* The mode of the engine that replays does not matter: a replay never calls a model, and changing the mode during or after a replay only affects the turns produced afterwards.
5. *Determinism.* A rule-mode run replays byte-identically, any number of times ([I6](#3-engine-invariants)). A mixed run replays identically as long as its recordings are present.
6. *Configuration drift.* When the authored configuration differs from the one the log was written under, a `config.warning` is written; it affects only the turns produced after it, never the replay of recorded ones.
7. *Playback chunks.* `timeline.replay` derives its chunks from the committed events instead of re-running the render: the echoed line of the player's input, each `narration` event, one full-line `text` chunk per `utterance` followed by its cues, the `choices` of a `choice.offered` event and one closing `done` per turn. A live S2 render streams the same utterance as several shorter `text` deltas, so a live chunk stream and its replay differ in chunk boundaries (never in the final text of an utterance). Only the event log and the replay-derived chunk stream are stable under [I6](#3-engine-invariants); the partial deltas of a live stream are not reproduced.
