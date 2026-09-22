# Animae Engine Specification v1.0

> This English edition is canonical. A Chinese edition of the same specification is kept in [spec.zh-CN.md](./spec.zh-CN.md).

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
- Routing and budget
- Dice and checks

The engine provides mechanisms only. All gameplay-specific choices are injected by upper layers through policy and preset.

## 2. Tech stack and deliverables

| Item | Specification |
|---|---|
| Language | TypeScript (latest stable, `strict`); output is ESM |
| Runtime | Node.js >= 24; Bun latest stable |
| Model layer | Vercel AI SDK Core (`ai@7`), wrapped behind `ModelPort` |
| Schema validation | zod 4 |
| Expressions | CEL, implemented with `@marcbachmann/cel-js` 8.x |
| Storage | Local plain-text files (YAML, Markdown, JSONL, JSON) |

| Deliverable | Contents |
|---|---|
| `@animae/engine` | Engine library |
| `@animae/preset-base` | Built-in base preset ([Section 19.4](#194-animaepreset-base)) |
| `@animae/preset-dnd` | Built-in DnD preset ([Section 19.5](#195-animaepreset-dnd)) |
| `@animae/tui` | Terminal game UI: Ink 8 (React) component library, plus a default game layout ([Section 21](#21-terminal-ui-animaetui)) |
| `animae` | Single executable built with `bun build --compile`, bundling `@animae/tui`, with two modes: interactive CLI/TUI and `animae serve --stdio` (stdio-based JSON-RPC 2.0 sidecar) |

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

## 4. Architecture

| Module | Responsibility |
|---|---|
| `schema` | zod definitions and extension registration |
| `store` | `StoragePort` implementation (filesystem); atomic writes (write temp file then rename); append writes with fsync |
| `timeline` | Event log, snapshots, saves, rewind, branches, carry set, prune, purge, export, replay |
| `rules` | CEL compile and execute, rule primitives, TS rule function registration |
| `adjudicator` | Proposal-to-event conversion and validation |
| `pipeline` | Turn pipeline and stage hooks |
| `characters` | Characters, level of detail (LOD), template generation, import/export |
| `memory` | Memory entries, knowledge docs, retrieval, forgetting, distortion, propagation, reflection |
| `fields` | Field declaration, grants, resolution, cost, ledger |
| `director` | Anchors, beats, sidenotes, exception channel |
| `world` | World variables, locations, items, calendar, scheduler, long events, offscreen simulation, lazy catch-up |
| `scene` | Scenes, participants, turn-taking, autonomous NPC dialogue |
| `introspect` | `query`, `grant`, `explain`, event subscription |
| `classify` | Input classification, safety classification |
| `router` | S1/S2 routing, budget, degradation, prompt segments |
| `dice` | Dice expressions and checks |
| `model` | `ModelPort`, AI SDK adapter, recording and playback |
| `policy` | Policy load, merge, validation |
| `rpc` / `cli` | JSON-RPC sidecar and CLI |

## 5. Data root directory

```
<root>/
  animae.yaml                 # Engine config: preset, policy list, seed, model ids
  world/
    world.yaml                # Language, calendar, initial world vars, chapter definitions
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
  timelines/<branch>/
    events.jsonl              # First line is branch.header
    snapshots/<eventId>.json
    entities/                 # Dynamically generated characters, locations, items on this branch
    artifacts/                # LLM artifacts: memory text, summaries, reflections
    recordings.jsonl          # LLM recordings
  saves.yaml                  # Save slot -> { branch, eventId }
  derived/                    # Rebuildable derived views
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
| Identity `identity` | `id`, `name`, `summary`, `language` (optional, overrides world language), `style_examples[]` |
| Constraint set `constraints` | `motives[]`; `bottom_lines[]`: `{id, text, tags[], hardness: hard\|soft}`; `taboos[]` (tags) |
| Traits `traits` | Custom dimensions `{name: number}`; `event_mult`: `{eventType: number}` (trait multipliers) |
| Tracks `tracks` | Defined by policy ([Section 7.3](#73-rule-primitives)); character files only store initial values and overrides |
| Goals `goals` | `[{id, text, tags[], priority}]` |
| Secrets `secrets` | `[{id, text, tags[], unlock: <CEL>}]` |
| Relations `relations` | `[{to, kind, tracks?, share: <CEL>}]` |
| Level of detail `lod` | `extra` (passerby) \| `supporting` (supporting role) \| `principal` (principal character) |

### 6.2 Level of detail

| LOD | Persisted content | Model for generation |
|---|---|---|
| `extra` | `identity` and a one-line `summary`; no persisted memory | S1 |
| `supporting` | `identity`, `constraints`, `tracks`, memory | S1 |
| `principal` | Full schema | S2 |

Promotion conditions are defined by CEL in templates. On promotion, the engine fills missing fields from the template for the target LOD, then writes a `character.promoted` event.

### 6.3 Dynamic generation

1. Generation may be triggered in three ways: upper layer calls `entities.generate`, rules emit `entity.generate` events, or the director triggers fallback via anchors.
2. Template file `templates/<kind>/<id>.yaml` contains: `fields` (zod-compatible field definitions), `guidance` (generation guidance text), `defaults`, `promote` (promotion rules).
3. Model output is a structured proposal; it passes schema validation and adjudicator validation in order; on success it is written under `timelines/<branch>/entities/` and an `entity.created` event is recorded.
4. Location and item generation use the same mechanism as characters.

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

`model` is always present: `{ slot: "s1" | "s2" | "", tags: string[] }`. Hosts attach capability tags to each model port (for example content tier labels). During prompt assembly the active slot is set from the pipeline tier (`s1` or `s2`); other stages leave `slot` empty and `tags` empty unless the host passes `extra.model`. Use `'tag' in model.tags` before relying on a tag.

### 7.3 Rule primitives

| Primitive | Parameters |
|---|---|
| `track` | `name`, `min`, `max`, `initial`, `tiers[]` (`{name, from}`), `hysteresis`, `decay` (`{toward, ratePerHour}`) |
| `delta_table` | `{eventType: {track: base}}` |
| `delta_formula` | Fixed as `base * intensity * sincerityFactor * traitMult * marginal(n)` |
| `marginal` | `k`; `n` is the count of like events received by the same NPC, decayed by `halfLifeHours` |
| `turn_cap` | `{track: maxAbsPerTurn}` |
| `window` | `{trigger: <CEL>, durationScenes, mult: {eventType: number}, capToLoss: bool}` |
| `threshold` | `{when: <CEL>, emit: <eventDraft>}` |
| `intent_rules` | `[{intent, when: <CEL>, score: <CEL>}]` |

`sincerityFactor` applies only to positive `base`: it equals `sincerity` (0-1). Negative `base` is unaffected.

### 7.4 Loading and validation

1. Policies load in this order: preset `extends` chain (deep merge, later overrides earlier) -> preset itself -> `policies` list in `animae.yaml` (in list order).
2. When the same key is defined more than once, the later load overrides the earlier and a `config.warning` event is written.
3. Invalid configuration rejects load and errors include file and path. Invalid configuration includes: references that do not exist, type mismatch, CEL compile failure, zod validation failure, field level exceeding grant.

## 8. Cognitive pipeline

```
input -> classify -> appraise -> check -> adjudicate -> applyFields -> decide -> route -> render -> commit
```

| Stage | Default implementation | Replaceability |
|---|---|---|
| `classify` | S1 outputs input class in the same call as `appraise` | Stage hook |
| `appraise` | S1 structured output: `{type, intensity, sincerity, approach, claims[], search_terms[], tags[], input_class, safety?}` | Stage hook |
| `check` | When policy declares check rules, roll dice and write `check.rolled` event | Rules |
| `adjudicate` | Emit `track.delta` events per event type and rule primitives | Rules |
| `applyFields` | Resolve all active fields per [Section 10](#10-field-system) | Rules (conflict resolver) |
| `decide` | Score per `intent_rules`, take highest; ties break by declaration order | Rules |
| `route` | Choose S1 or S2 per [Section 17](#17-routing-budget-and-caching) | Policy |
| `render` | Stream generation, output `text` chunks and `cue` chunks; attach choices per policy | Stage hook |
| `commit` | Append events, update derived state, write memory asynchronously | -- |

**Synchronous calls**: LLM calls that block the player from seeing the reply. Fixed at 2 per turn: one `appraise`, one `render`.

**Generation output schema**: `{text, cues[], intent_realized, choices?[]}`.

- When `intent_realized` disagrees with `decide`, record an `intent.mismatch` event. Whether to retry is controlled by policy `render.retryOnMismatch`, value 0 or 1.

**Cues**:

- Cue chunk format: `{type:"cue", cue:{type, args}, at:<text character offset>}`.
- Available cue types and argument schemas are declared in policy `cues.types`.

**Choices**:

- Policy `choices` config: `{enabled, count, filter: <CEL>}`.
- When enabled, the same `render` output includes `choices[]`; each item is `{text, expected_event_type, tags[]}`.
- Options failing `filter` are dropped and a `choice.filtered` event is recorded.

**Output language**: Prefer `identity.language`, else `language` in `world.yaml` (BCP 47 tag). Language affects only `render` and `entities.generate`.

## 9. Memory and knowledge

### 9.1 Memory entries

Memory entries live in `artifacts/<npc>/memory.jsonl`, format:

```
{id, t, kind: episodic|semantic|summary|reflection, text, tags[], claims[{s,p,o}], importance(0-1), valence(-1-1), src: eventId, branch}
```

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
| `always` | While in scope, body injects into the semi-static segment |
| `when` | When CEL condition is true, body injects into the dynamic segment |
| `on-demand` | Only `name` and `description` go in the index segment; at most 50 in scope, sorted by `priority` descending. Body loads on retrieval hit or when S2 calls the `read` tool |

### 9.3 Retrieval

- **Recall**: Case-insensitive substring and regex match on `appraise.search_terms` over in-scope memory entries and knowledge docs. No index is built.
- **Scoring**: `0.5 * term hit rate + 0.2 * recency + 0.2 * importance + 0.1 * field salience weight`. Recency half-life is 7 world days.
- **Take**: Top 8 by score (K = 8), inject into dynamic segment.
- **S2 turns**: S2 may use tools `search({query, scope, tags})` and `read({id})`, at most 3 steps; tool results are recorded.
- **Vector retrieval**: Only the interface is defined: `EmbeddingPort { embed(texts: string[]): Promise<Float32Array[]> }`. When enabled, vector score enters at weight 0.3 and other terms scale proportionally.

### 9.4 Forgetting

- Controlled by policy `memory.forgetting`; disabled when `enabled: false`.
- Retention: `retention = exp(-ageDays / (tau * (0.5 + importance)))`.
- Entries below `threshold` are excluded from retrieval but not deleted.

### 9.5 Distortion

- Controlled by policy `memory.distortion`: `{enabled, p, maxImportance, kinds: [intensify, swap_subject, add_motive]}`.
- On retrieval hit, with probability `p` attach a distortion instruction to the entry and write `memory.distorted` event.
- Original text never changes; distortion applies only to that `render`.

### 9.6 Propagation

- Controlled by policy `memory.propagation`: `{enabled, onTick: day, distortionPerHop}`.
- Each propagation tick, for entries marked `shareable`, propagate one hop along edges where `relations[].share` is true.
- Each hop increments distortion count and writes `memory.propagated` event.

### 9.7 Reflection

- On `scene.end`, invoke S2 once asynchronously per `principal` character; output proposal: `{summaries[], goal_changes[], new_claims[]}`.
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
| L0 narrative conditions | Environment and timing | `world_vars`, `event_prob: {id: Δ}`, `salience: [{tags, boost}]`, `topic_access: {open[], close[]}`, `schedule_offset: {id: minutes}` |
| L1 numeric | Tracks and checks | `track_mult: {track: {eventType\|"*": m}}`, `track_offset`, `track_caps`, `tier_shift`, `check_mod: {skill\|"*": {bonus, advantage}}` |
| L2 intent | Intent | `intent_force`, `intent_forbid[]`, `intent_bias: {intent: score}` |
| L3 rules | Rules | `rule_override: {ruleId: ruleId}`, `rule_add[]` |
| L4 perception | NPC self-view | `hide_entities[]`, `disguise: {entity: asEntity}`, `inject_belief: [{text, tags, claims}]`, `suppress_memory_tags[]` |

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
| Sidenote | `director.sidenote(npc, text, {ttlTurns, verbatim: bool})`. Hint text injects into dynamic segment; when `verbatim: false`, if generated content contains 8 or more consecutive characters from the hint text, write `sidenote.echoed` event |
| Exception channel `exceptions.yaml` | `{id, charges, period: session\|day\|chapter, mayBypass: [field_cap, cost_due, track_cap, rule:<id>, constraint:<id>]}`, used via `director.invokeException`, writes `exception.used` event |

## 12. World and time

### 12.1 World state

World state includes `world.vars`, locations, items, and factions; all are event-sourced.

### 12.2 Calendar

Configured in `world.yaml`:

```yaml
language: zh-CN
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

### 12.5 Offscreen simulation

| Fidelity | Behavior |
|---|---|
| `none` | No advancement |
| `rule` | Scheduler, rules, and decay only |
| `narrate` | On top of `rule`, for visible traces within observation point call S1 for one sentence of narration, written as artifact |
| `full` | On top of `narrate`, generate offscreen dialogue for scheduled character meetings; route S1 and S2 per [Section 17](#17-routing-budget-and-caching) |

Fidelity is configured by policy `offscreen.fidelity`, per location and per character.

### 12.6 Lazy catch-up

When any of the following occurs, the engine catches the corresponding location or character up from the last advanced time to the current time:

- A scene starts and involves that location or character;
- Observer `player` queries that location or character.

After catch-up completes, write `offscreen.simulated` event.

## 13. Timeline

| Capability | Spec |
|---|---|
| Save | `timeline.save(label)`: writes `{branch, eventId}` to `saves.yaml` |
| Load | `timeline.load(slot)`: replays from the nearest snapshot; replay uses recorded data |
| Rewind | `timeline.rewind(eventId)`: forks a new branch at that event, writes `branch.header` and `branch.forked` events; the original branch is unchanged |
| Branches | `timeline.branches()` lists all branches; `timeline.switch(branch)` switches branch; `timeline.diff(a, b)` returns state and event differences between two branches |
| Carry set | Configured by policy `timeline.carry`: `[{characters: [ids]\|"*", kinds: [memory, track, world_var], tags: [..], when: <CEL>}]`. When forking a branch, matching entries are copied to the new branch, tagged with `carriedFrom`, and a `carry.applied` event is written |
| Prune | `timeline.prune(branch)`: deletes the directory of a branch that has no child branches |
| Purge | `purge(scope)`: physically deletes matching artifacts; corresponding text fields in the event log are replaced with `"[redacted]"`; writes a `purge.applied` event |
| Export | `timeline.export(branch, {recordings: bool})`: exports to a single `.asave.jsonl` file. Line 1 is a manifest `{engine, preset, branch, chain[], hashes}`; each following line is `{path, content}`. Content includes world definitions, character definitions, policies, events and artifacts on the full ancestor chain from the root branch to the current branch, and optional recording data |
| Import | `timeline.import(file)`: validates hashes on import and creates a new branch |
| Playback | `timeline.replay(branch, {from, to})`: emits `TurnChunk` values turn by turn, all using recorded data |
| Recording | Each line in `recordings.jsonl` is `{key: hash(model, prompt, params, seed), response}`. In replay mode, a missing recording is an error |
| Hot reload | At the end of each turn, authored file hashes are compared. On change, reload and validate: if validation passes, write a `config.reloaded` event (with new hashes); if validation fails, keep the old configuration and write a `config.error` event. During replay, if configuration hashes differ, a `config.warning` event is written |

## 14. Multi-character orchestration

| Item | Spec |
|---|---|
| Participants | Specified by `scene.start({participants})`; may include any number of NPCs |
| Turn taking | Configured by policy `scene.turnTaking`: `addressed` (the addressed character speaks), `round_robin` (speak in rotation), or `priority: <CEL>` (highest-scoring character) |
| Autonomous NPC dialogue | Configured by policy `scene.autonomous`: `{maxExchangesPerPlayerTurn, when: <CEL>}`. Each exchange runs the full turn pipeline and counts toward budget |
| S2 budget | One shared budget pool within the scene, consumed in escalation-trigger order |

## 15. Introspection and visibility

| Item | Spec |
|---|---|
| Viewers | Five built-in: `debug` (always fully visible), `author`, `gm`, `player`, `npc:<id>` (character self-view, with L4 effects applied). Upper layers may register custom viewers with `introspect.registerViewer` |
| Paths | `characters/<id>/{identity,constraints,traits,tracks,tiers,goals,secrets,memory,knowledge,alias}`, `world/{vars,locations,items}`, `ledger`, `events`, `timeline` |
| Visibility policy | `visibility.rules: [{viewer, path: <glob>, allow: bool}]`, evaluated in order; the last matching rule wins; deny when no rule matches |
| Temporary grant | `grant(viewer, path, ttl)`: writes a `visibility.granted` event; on expiry writes a `visibility.expired` event |
| explain | `explain(turnId, viewer)` returns the event chain for that turn: input, appraisal, checks, track changes, fields, intent, routing, retrieval hits. Results are filtered by visibility |
| Subscribe | `on(kind, handler)`; `kind` supports wildcards |

## 16. Input classification and safety

| Item | Spec |
|---|---|
| Input class | `normal`, `injection_suspect`, `meta_probe`; emitted by `appraise` |
| Class response | Configured by policy `input.response`: `{class: {emit: <eventType>, intent: <intent>} \| hook: <fn>}` |
| Safety classification | Off by default. Enable with policy `safety.enabled: true`. When enabled, `appraise` also emits `safety` as one of `none`, `self_harm`, `real_world_danger`, `sexual_minors`, `personal_crisis` |
| Safety response | `safety.response: in_character \| out_of_character_notice \| block \| hook:<fn>` |
| Safety logging | `safety.log: bool`. When `true`, writes a `safety.flagged` event |

## 17. Routing, budget and caching

### 17.1 Escalation triggers

Configured by policy `router.triggers`; satisfying any one escalates to S2.

| Trigger | Parameters |
|---|---|
| `anchor_near` | No more than N scenes until deadline |
| `secret_topic` | Appraisal `tags` intersect `secrets[].tags` |
| `mood_spike` | `\|Δmood\| ≥ a` or `\|mood\| ≥ b` |
| `tier_change` | Any track crosses a tier boundary |
| `contradiction` | Appraisal `claims` and memory `claims` share subject and predicate but differ in object |
| `ambiguity` | `type == other`; or `sincerity < 0.3` with a positive event type; or `input_class == injection_suspect` and `type != insincere_speech` |
| `field_high` | An L2 or higher field applies this turn |
| `sidenote` | A sidenote is received this turn |
| `scene_first` | First turn of the scene |

### 17.2 Budget

Configured by policy `router.budget`:

```
{syncCallsPerTurn: 2, s2PerTurn: 1, s2Ratio, s2ReservedForAnchors, maxOutputTokens: {s1, s2}}
```

### 17.3 Degradation

When budget is exceeded, execute in the order listed in policy `router.degrade`. Optional actions:

- `s2_to_s1`: use S1 on non-anchor turns
- `defer_reflection`: defer reflection
- `skip_offscreen_narrate`: skip offscreen narration
- `skip_autonomous`: skip autonomous NPC dialogue

Each degradation step writes one `budget.degraded` event.

### 17.4 Prompt segments

| Segment | Content | Cache breakpoint |
|---|---|---|
| Static | World rules, `always` knowledge, identity, constraint set, voice | 1st |
| Semi-static | Relationship summaries, long-term memory summaries, `on-demand` index; updated once per scene | 2nd |
| Dynamic | Tier labels, field effects, `when` knowledge, retrieval results, last K dialogue turns (K from policy), sidenotes | — |

Cache breakpoints are passed to the model provider via the AI SDK `providerOptions`.

## 18. Dice and checks

| Item | Spec |
|---|---|
| Expression | `NdM[kh\|klK][±C]`, e.g. `2d20kh1+5` |
| Randomness | `ctx.rng`, seeded from timeline seed and event id |
| Check | `check({expr, dc, advantage, disadvantage})`. Advantage and disadvantage cancel when both apply; result is written to a `check.rolled` event as `{expr, rolls[], total, dc, success}` |
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
| `fields.grants` / `fields.caps` | Field grants and numeric caps |
| `memory.*` | Retrieval weights, K, forgetting, distortion, propagation |
| `reflection.accept` | Rules for accepting reflection proposals |
| `characters.lod` | Level of detail and promotion rules |
| `offscreen.fidelity` | Offscreen simulation fidelity |
| `scene.turnTaking` / `scene.autonomous` | Turn taking; autonomous NPC dialogue |
| `router.*` | Escalation triggers, budget, degradation |
| `render.*` | `retryOnMismatch`, recent dialogue turn count K |
| `cues.types` | Cue types |
| `choices` | Player choices |
| `timeline.carry` / `timeline.allowRewind` | Carry set; whether rewind is allowed |
| `visibility.rules` | Visibility rules |
| `checks` | Check rules |

### 19.2 Presets

A preset is a directory or npm package containing `preset.yaml` (fields `id`, `extends[]`, `policies[]`), templates, knowledge documents, and rule functions.

### 19.3 Model configuration

Startup must provide two `ModelPort` instances for `s1` and `s2`; otherwise error. Example `animae.yaml`:

```yaml
preset: "@animae/preset-dnd"
seed: 42
models:
  s1: { provider: anthropic, model: claude-haiku-5-5 }
  s2: { provider: anthropic, model: claude-opus-5-5 }
policies: [policies/my-tweaks.yaml]
```

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
| Memory | Retrieval weights per [Section 9.3](#93-retrieval), K = 8; forgetting, distortion, and propagation all off |
| Reflection | `reflection.accept` uses default rules from [Section 9.7](#97-reflection) |
| LOD | `extra → supporting`: `interactions >= 3 \|\| 'named' in tags`; `supporting → principal`: referenced by an anchor, or `interactions >= 15` |
| Offscreen | `offscreen.fidelity: rule` |
| Scene | `scene.turnTaking: addressed`; `scene.autonomous.maxExchangesPerPlayerTurn: 0` |
| Routing | All triggers enabled; parameters `anchor_near N=1`, `mood_spike a=30 b=80` |
| Budget | `syncCallsPerTurn 2`, `s2PerTurn 1`, `s2Ratio 0.15`, `s2ReservedForAnchors 0.03`, `maxOutputTokens s1 400 / s2 800` |
| Degradation | `router.degrade`: `[s2_to_s1, defer_reflection, skip_offscreen_narrate, skip_autonomous]` |
| Render | `render.retryOnMismatch: 0`; recent dialogue turns K = 12 |
| Cues | `cues.types`: `expression{name}`, `action{name}`, `sfx{name}` |
| Choices | `choices.enabled: false` |
| Timeline | `timeline.allowRewind: true`; `timeline.carry: []` |
| Visibility | `author` and `gm` can see everything; `player` can only see speech and choices in `events`, and entries in `world/vars` tagged `public`; `npc:<id>` can only see its own self-view |

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
| Charmed | L1 + L2 | Caster gains advantage on social checks against the target; target intent must not include the `hostile` tag |
| Frightened | L1 | While the source of fear is visible, all checks are at disadvantage |
| Poisoned | L1 | All ability checks are at disadvantage |
| Exhaustion | L1 | -2 on all d20 checks per level |

**Rest**: short rest advances world time by 60 minutes; long rest by 480 minutes and removes 1 level of Exhaustion.

**Attribution**: distributions of this preset must include:

> This work includes material from the System Reference Document 5.2.1 ("SRD 5.2.1") by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.

## 20. Interfaces

### 20.1 TypeScript API

```ts
function createEngine(opts: {
  root: string;
  models: { s1: ModelPort; s2: ModelPort };
  modelMode?: "live" | "record" | "replay";     // default "record"
  ports?: { storage?: StoragePort; embedding?: EmbeddingPort };
  seed?: number;
}): Promise<Engine>;

interface Engine {
  world:     { now(): WorldTime; advance(by: Duration | { to: WorldTime }): Promise<EngineEvent[]>; set(path: string, value: unknown): void };
  scene:     { start(s: { location: string; participants: string[]; fields?: string[] }): Promise<SceneId>;
               turn(t: { sceneId: SceneId; actor: string; text: string; addressee?: string; choiceId?: string }): AsyncIterable<TurnChunk>;
               end(sceneId: SceneId): Promise<SceneReport> };
  entities:  { generate(r: { kind: "character" | "location" | "item"; template: string; hints?: Record<string, unknown> }): Promise<EntityRef>;
               promote(id: string, to: Lod): Promise<void> };
  fields:    { declare(f: FieldDef): void; grant(f: FieldDef): LedgerEntry; revoke(id: string): void };
  director:  { sidenote(npc: string, text: string, o?: { ttlTurns?: number; verbatim?: boolean }): void;
               invokeException(id: string, target: string): LedgerEntry };
  timeline:  { current(): BranchRef; save(label?: string): SaveSlot; load(slot: SaveSlot): Promise<void>;
               rewind(to: EventId): Promise<BranchRef>; branches(): BranchRef[]; switch(b: BranchRef): Promise<void>;
               diff(a: BranchRef, b: BranchRef): TimelineDiff; prune(b: BranchRef): Promise<void>;
               export(b: BranchRef, o?: { recordings?: boolean }): Promise<string>; import(file: string): Promise<BranchRef>;
               replay(b: BranchRef, r?: { from?: EventId; to?: EventId }): AsyncIterable<TurnChunk> };
  rules:     { register(name: string, fn: RuleFn): void };
  hooks:     { register(stage: Stage, fn: StageHook): void };
  introspect: { registerViewer(v: ViewerDef): void };
  query(viewer: Viewer, path: string): unknown;
  grant(viewer: Viewer, path: string, ttl?: Duration): void;
  explain(turnId: TurnId, viewer: Viewer): Explanation;
  on(kind: string, h: (e: EngineEvent) => void): () => void;
  purge(scope: { characters?: string[]; memoryIds?: string[]; sessions?: string[] }): Promise<void>;
  importCard(file: string): Promise<string>;
  exportCard(id: string): Promise<string>;
  close(): Promise<void>;
}

type TurnChunk =
  | { type: "text"; text: string; newUtterance?: boolean }
  | { type: "cue"; cue: { type: string; args: Record<string, unknown> }; at: number }
  | { type: "choices"; choices: { id: string; text: string; expected_event_type: string; tags: string[] }[] }
  | { type: "done"; turnId: TurnId; events: EventId[] };

Consecutive `text` chunks from the same speaker between two `done` chunks are streaming fragments of one utterance unless `newUtterance` is set. Consumers must append fragments into a single transcript row and emit one stream start/end pair per utterance.

interface ModelPort {
  id: string;
  object<T>(req: { schema: ZodType<T>; segments: PromptSegments; tools?: ToolDef[]; maxOutputTokens: number }): Promise<T>;
  stream(req: { schema: ZodType<unknown>; segments: PromptSegments; tools?: ToolDef[]; maxOutputTokens: number }): AsyncIterable<StreamPart>;
}
```

### 20.2 JSON-RPC sidecar

- Start command: `animae serve --stdio --root <dir>`.
- Method names correspond one-to-one with API paths, e.g. `scene.turn`, `timeline.rewind`, `query`.
- Streaming results are pushed via `turn.chunk` notifications with parameters `{requestId, chunk}`.
- Engine events are pushed via `event` notifications; call `subscribe({kinds})` first to subscribe.

### 20.3 CLI

| Command | Function |
|---|---|
| `animae init <dir> [--preset <id>]` | Generate data root skeleton |
| `animae validate` | Load and validate all configuration |
| `animae run [--scene <location>] [--with <ids>] [--viewer <v>] [--theme <file>] [--plain]` | Interactive run. Default starts the TUI default layout; with `--plain`, plain-text line mode. Both modes support `:save`, `:load`, `:rewind <eventId>`, `:branches`, `:explain [turnId]`, `:query <viewer> <path>`, `:advance <duration>` |
| `animae inspect <path> [--viewer <v>]` | Query state |
| `animae timeline <list\|save\|load\|rewind\|switch\|diff\|prune\|export\|import\|replay> ...` | Timeline operations |
| `animae import-card <file>` / `animae export-card <id>` | Character card import and export |
| `animae serve --stdio` | Start JSON-RPC sidecar |

## 21. Terminal UI `@animae/tui`

### 21.1 Technical foundation

| Item | Spec |
|---|---|
| Renderer | Ink 8 (React) |
| Runtime | Node ≥ 24 and Bun; may be bundled into the `animae` executable |
| Connection | Calls the `Engine` instance in-process |
| Data reads | All panel content via `engine.query(viewer, path)`, subject to visibility; default viewer is `player` |
| Character width | Unicode display width; correct handling of CJK fullwidth characters |
| Terminal size | Dual-column layout when width ≥ 100; single column at 80–99 with sidebar as overlay; prompt to enlarge terminal below 80×24 |

### 21.2 Default layout

```
┌ Header: world time · location · chapter · branch ─────────────────────────────┐
│ Transcript (dialogue, 70%)            │ SidePanel (30%)                     │
│  Name [expression]: line (typewriter)   │  Participants and visible tracks/tiers │
│  (action narration)                   │  Active fields (if visible)         │
│                                       │  Current anchor/beat (if visible)     │
├───────────────────────────────────────┴───────────────────────────────────────┤
│ ChoiceMenu (when choices exist)                                               │
│ InputLine: > enter line or :command                                           │
└ Footer: key hints · routing (S1/S2) · budget usage ───────────────────────────┘
```

### 21.3 Overlays and keys

| Key | Action |
|---|---|
| Enter | Submit input |
| ↑ / ↓, 1–9 | Move in choice menu or select directly |
| Any key (during typewriter) | Show full current text immediately |
| Tab | Switch focus between Transcript and SidePanel; focused region scrolls |
| F1 | Help |
| F2 | Event log EventLog (filter by kind) |
| F3 | Timeline browser TimelineBrowser: branch tree, save slots, switch, rewind |
| F4 | explain for previous turn |
| F5 | State inspector Inspector, interactive `query` |
| Ctrl+S / Ctrl+L | Save / load |
| Ctrl+Z | Rewind to previous turn: confirm, then fork new branch |
| Esc | Close current overlay |
| Ctrl+C | Close engine and exit |

Overlay content is filtered by the current viewer.

### 21.4 Cue rendering

- Each cue type has a `CueRenderer`, fired aligned to `at` offset and typewriter progress.
- Three built-in renderers:

  | cue type | Rendering |
  |---|---|
  | `expression` | Show `[name]` after character name |
  | `action` | Insert italic, dim narration line |
  | `sfx` | Display as `♪ name`; terminal bell when theme `bell: true` |

- Cue types without a registered renderer are not shown; they are recorded only in the event log.

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
| `Transcript` | Dialogue stream with `Typewriter` and cue rendering |
| `Typewriter` | Character-by-character text with skip support |
| `ChoiceMenu` | Player choice menu |
| `InputLine` | Input line with history and `:` commands |
| `SidePanel`, `TrackBar`, `FieldList` | Sidebar, track bars, field list |
| `EventLog`, `TimelineBrowser`, `ExplainView`, `Inspector` | Overlay views |
| `Overlay` | Overlay container |

| Hook `hooks` | Role |
|---|---|
| `useEngine()` | Current `Engine` instance |
| `useTurn()` | Submit input; subscribe to current turn `TurnChunk` stream |
| `useQuery(path)` | Query state as current viewer; refresh on change |
| `useEvents(kinds)` | Subscribe to engine events |
| `useTheme()` | Current theme |
| `useKeymap()` | Read and register key bindings |

Upper layers may replace the entire `layout`, compose components, register cue renderers, or override key bindings.
## 22. Event type catalog

| Group | Events |
|---|---|
| Input | `input.received`, `input.classified`, `appraisal`, `safety.flagged` |
| Checks | `check.rolled` |
| Tracks | `track.delta`, `tier.changed` |
| Fields | `field.applied`, `field.rejected`, `field.cost_due`, `field.cost_settled` |
| Intent and generation | `intent.decided`, `intent.mismatch`, `route.decided`, `utterance`, `choice.offered`, `choice.taken`, `choice.filtered` |
| Memory | `memory.written`, `memory.distorted`, `memory.propagated`, `reflection.proposed`, `reflection.accepted`, `reflection.rejected` |
| Entities | `entity.created`, `character.promoted` |
| World | `world.var_set`, `time.advanced`, `schedule.fired`, `longevent.phase`, `longevent.interrupted`, `offscreen.simulated` |
| Director | `anchor.progress`, `anchor.fulfilled`, `anchor.fallback`, `beat.entered`, `beat.exited`, `sidenote.added`, `sidenote.expired`, `sidenote.echoed`, `exception.used` |
| Visibility | `visibility.granted`, `visibility.expired` |
| Timeline | `branch.header`, `branch.forked`, `carry.applied`, `purge.applied` |
| Config and budget | `config.reloaded`, `config.warning`, `config.error`, `budget.degraded` |

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
| Stage Hook | Function that replaces a pipeline stage |
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
| Reflection | S2 proposal at scene end |
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
| S1 | System 1: fast, low-cost model tier |
| S2 | System 2: deep-reasoning model tier |
| Routing | Choice between S1 and S2 |
| Escalation Trigger | Condition that invokes S2 |
| Synchronous Call | LLM call that blocks the reply |
| Budget | Caps on calls and tokens |
| Degradation | Ordered handling when budget is exceeded |
| Prompt Segments | Static, semi-static, and dynamic segments |
| Cue | Structured performance tag aligned with text |
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
