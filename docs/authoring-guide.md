# Authoring guide

All paths are relative to the **data root** (the directory containing `animae.yaml`). Schemas live in `packages/engine/src/schema/{authored,policy,common}.ts`. A **validated copy** of the examples below is in [`docs/examples/tutorial/`](./examples/tutorial/) — run:

```bash
./dist/animae validate --root docs/examples/tutorial
./dist/animae validate --root docs/examples/tutorial --mode rule
```

## Data root layout

```
animae.yaml
policies/*.yaml
world/world.yaml
world/locations/*.yaml
world/items/*.yaml
world/fields/*.yaml
world/knowledge/*.md
world/anchors.yaml          # optional
world/beats.yaml            # optional
world/exceptions.yaml       # optional
world/schedule.yaml         # optional
characters/<id>/{card.md, traits.yaml, tracks.yaml, goals.yaml, secrets.yaml, relations.yaml}
characters/<id>/knowledge/*.md   # optional per-character
templates/{character,location,item}/*.yaml
mods/<modId>/mod.yaml          # optional content packs (see mods.md)
mods/<modId>/world/...         # overlay tree mirroring paths above
timelines/<branch>/events.jsonl
saves.yaml
derived/                    # runtime caches (gitignore)
```

---

## `animae.yaml`

```yaml
# Required-ish: seed drives timeline RNG
seed: 7
# Preset bundle id (exact string from PresetBundle.id)
preset: "@animae/preset-base"
# Extra policy layers (merged after preset chain)
policies:
  - policies/tutorial.yaml
# Optional enabled mod ids (overlays under mods/<id>/)
mods: []
# Optional LLM endpoints (omit for rule-only play)
# mode: rule | llm | hybrid
# appraise.backend: llm | rule
# render.backend: llm | rule
# runtime:
#   switchAt: turn_boundary | immediate
#   fallbackOnError: { appraise: true, render: true, ... }
models:
  s1: { provider: anthropic, model: claude-haiku-4-5 }
  s2:
    default: std
    tiers:
      - { id: std, provider: anthropic, model: claude-sonnet-4-5 }
    routing: { render: std, offscreen: std, autonomous: std }
```

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `preset` | string | — | Resolved via CLI/game `presets` registry |
| `seed` | int | `0` | Combined with branch for `timeline.rng` |
| `policies` | string[] | `[]` | Paths under data root |
| `mods` | string[] | `[]` | Enabled mod ids; host may override via `createEngine({ mods })`. See [mods.md](./mods.md). |
| `mode` | `llm` \| `hybrid` \| `rule` | derived | Starting runtime mode; see [spec Section 19.3](./spec.md#193-model-configuration) |
| `models.s1` | `ModelSpec` | — | S1 role (structured judgment). `{ provider: rule }` or omit → rule backend |
| `models.s2` | `ModelSpec` or tier list | — | S2 role: single model = one tier `only`, or `default` + `tiers[]` + `routing` |
| `appraise.backend` / `render.backend` | `llm` \| `rule` | — | Per-role override when `mode: hybrid` |
| `runtime.*` | object | — | Mode switching timing and per-phase fallback to rules |
| `gallery` | object | — | CG preset entries, ratings, capture/render defaults. See [gallery.md](./gallery.md). |

Optional **`gallery`** block: preset CG slots, content ratings (CEL), and generator defaults. Character cards may add **`identity.visual`** (generator appearance tags) used when composing image prompts for entries that list that character.

---

## `world/world.yaml`

```yaml
title: Tutorial
language: en          # BCP 47 → prompt language
player: player        # character id
start_location: home
calendar:
  sceneMinutes: 15    # min duration credited at scene.end
  turnMinutes: 1      # per processed turn
  chapters: []        # { id, days: [from,to], title? }
start: { day: 1, minute: 480 }
vars:
  quest_started: false
public_vars:          # keys visible to viewer `player` in world.vars
  - quest_started
rules_text: ""        # optional static prompt injection
factions: {}          # id → { name, summary?, vars? }
```

---

## Locations — `world/locations/<id>.yaml`

```yaml
id: market
name: Market Square
summary: Busy stalls.
tags: [public]
connects:
  - { to: home, minutes: 10, label: path }
vars: {}
description: ""       # optional long text
x: {}                 # optional offscreen hints
```

---

## Items — `world/items/<id>.yaml`

```yaml
id: town-map
name: Town map
summary: Crude ink sketch.
tags: [item]
holder:               # optional EntityRef
  kind: character
  ref: player
vars: {}
```

`EntityRef`: `{ kind: character|location|item|faction, ref: <id> }`.

---

## Fields — `world/fields/*.yaml`

One document per file; file may contain a single object or an array.

```yaml
id: welcome-boost
holder: { kind: character, ref: guide }
source: author       # author | rule | anchor | runtime
level: L1            # L0–L4 caps which effects apply
priority: 0
stacking: add        # add | max | override | resolver:<name>
scope:
  location: home
  turns: 3
  when: "scene.first"
effects:
  track_offset:
    affinity: 1
```

**Effects by level** (enforced at load):

| Level | Keys |
|-------|------|
| L0 | `world_vars`, `event_prob`, `salience`, `topic_access`, `schedule_offset` |
| L1 | `track_mult`, `track_offset`, `track_caps`, `tier_shift`, `check_mod` |
| L2 | `intent_force`, `intent_forbid`, `intent_bias` |
| L3 | `rule_override` (`{originalId: replacementId}`), `rule_add` (array of `{id, fn, when?, stage?}` like `rules.custom`; runs while field in scope; `tick` not allowed) |
| L4 | `hide_entities`, `disguise`, `inject_belief`, `suppress_memory_tags` |

Optional `cost`: `{ payer, effects?, events?, due?, ttlScenes, fallback? }`.

---

## Anchors — `world/anchors.yaml` (array)

```yaml
- id: meet-guide
  title: First meeting
  target:
    kind: character_state   # world_event | info_arrival | character_state | character_choice
    spec:
      character: guide
      when: "tracks.affinity >= 55"
  deadline: { day: 1, minute: 1200 }   # or CEL string
  strategies: [soft, hard, force]
  soft: { ...FieldDef... }             # optional field applied as nudge
  hard:
    - kind: world.var_set
      path: quest_started
      value: true
  force: { ...FieldDef... }            # optional
  refs: [guide]                        # keep promoted / S2 routing
```

---

## Beats — `world/beats.yaml` (array)

```yaml
- id: morning
  enter: "time.hour >= 6 && time.hour < 12"
  exit: "time.hour >= 12"
  fields: [welcome-boost]
  note: "Morning light; vendors are setting up."
```

While active, `note` is injected into the dynamic prompt segment.

---

## Exceptions — `world/exceptions.yaml` (array)

```yaml
- id: storyteller-grace
  charges: 1
  period: session | day | chapter
  mayBypass:
    - track_cap
    - field_cap
    - cost_due
    - rule:<name>
    - constraint:<name>
```

Invoked via engine `director.invokeException(id, target)` or game UI.

---

## Schedule — `world/schedule.yaml` (array)

Each item needs `at` **or** `every`, and `emit` **or** `rule`.

```yaml
- id: noon-bell
  every: "day 12:00"
  when: "true"
  emit:
    kind: world.var_set
    path: last_bell
    value: noon

- id: blind-tide-example
  at: "day 30 06:00"
  duration: 2880
  phases:
    - { id: whisper, minutes: 720 }
  emit: [...]
  onInterrupt: myRuleFn
  rule: myHost.dailyTick           # alternatively: registered rule name
```

---

## Knowledge — `world/knowledge/*.md` or `characters/<id>/knowledge/*.md`

Markdown body + YAML frontmatter:

```yaml
---
name: market-rules
description: Basic market etiquette
scope: location:market    # world | location:<id> | character:<id> | scene:<id>
inject: always            # always | when | on-demand
when: "check.success"      # required if inject: when (CEL; includes `model.slot` / `model.tags`)
tags: [market]
priority: 0
shareable: false
---
No haggling after sundown.
```

Doc id at runtime: `world/<relpath>` or `character:<id>/<file>`.

---

## Characters — `characters/<id>/`

Directory name must match character id (except generated entities).

### `card.md`

```markdown
---
identity:
  name: Guide
  summary: A friendly NPC.
  style_examples: ["Sure thing."]
  greeting: ""       # optional
  nickname: ""
  color: ""
constraints:
  motives: [help newcomers]
  bottom_lines:
    - id: no-theft
      text: Will not assist theft.
      tags: [theft]
      hardness: hard    # hard → self.hard_bottom_line_tags in CEL
  taboos: []         # tags; prompts show `taboo.<tag>.label` from the string tables when present, else the tag itself
lod: principal          # principal | supporting | extra
tags: [npc]
style: Warm, concise.
---
Persona prose for prompts.
```

### Name references (`{{name:<id>}}`)

In knowledge, templates, gallery strings, and persona prose, refer to characters with **`{{name:player}}`** or **`{{name:<characterId>}}`** instead of hard-coded names. At prompt assembly the engine expands markers to card labels (nickname-aware for the speaker line). Runtime aliases from `engine.setAlias` win over card text.

For **UI display strings** resolved in another language than the content locale, register parallel spellings in locale string tables: `character.<id>.name` and `character.<id>.nickname`. Pass `{ localizeNames: true }` to `Engine.display.resolve(locale, value, { localizeNames: true })` so gallery titles, hints, and `$t:`-lifted copy match the viewer language; a player-chosen alias still wins. Prompts always use card labels, with an optional cross-language glossary when output locale differs from content locale (see [i18n.md](./i18n.md)).

### `traits.yaml`

```yaml
event_mult:
  smalltalk: 1.1
```

Preset extensions (DnD) add structured traits validated by `policy.schema.extend`.

### `tracks.yaml`

```yaml
self: { mood: 55 }
toward:
  player: { affinity: 52, trust: 48 }
  "*": { affinity: 50 }    # default target
overrides: {}               # per-track def overrides
```

### `goals.yaml` / `secrets.yaml` (arrays)

```yaml
- id: greet-visitors
  text: Welcome newcomers.
  tags: [social]
  priority: 1
```

```yaml
- id: hidden-stall
  text: Knows a back-alley vendor.
  tags: [market]
  unlock: "tracks.affinity >= 60"
```

A secret stays locked until its `unlock` expression holds (default `false`, so a secret without `unlock` never opens by itself). The engine evaluates it after adjudication in every turn for the character who answers: `tracks.<name>` is that character's track toward the character they are dealing with. When it becomes true the secret unlocks permanently (`character.secret_unlocked`); from then on its text is part of the character's prompt and readable through `characters/<id>/secrets`. While a secret is locked, its `tags` make a matching appraisal count as a `secret_topic` escalation trigger.

### `relations.yaml`

```yaml
- to: player
  kind: acquaintance
  tracks: { affinity: 52 }
  share: "tracks.trust >= 40"
  note: Met at the cottage.
```

---

## Templates — `templates/<kind>/<name>.yaml`

```yaml
id: stranger
kind: character
guidance: Generate a brief passer-by.
fields:
  name: { type: string, description: Display name }
  quirk: { type: string }
defaults: { lod: supporting }
promote:
  - { to: principal, when: "event.intensity > 0.7" }
```

Used by `engine.entities.generate({ kind, template, hints })`.

---

## Policies — `policies/*.yaml`

Partial documents merged deep-first: preset chain → `animae.yaml` `policies` list order. See [policy-reference.md](./policy-reference.md). Arrays **replace** unless:

```yaml
intent_rules:
  $append:
    - { intent: custom, when: "true", score: 1 }
```

---

## Timeline bootstrap

`timelines/main/events.jsonl` must begin with a branch header:

```json
{"kind":"branch.header","branch":"main"}
```

`init` creates this automatically.

---

## Rule-backend content (no LLM)

When a role runs on the **rule backend**, prose and structured outputs come from policy, not from a model. Author these keys (see [spec Appendix C](./spec.md#appendix-c-rule-backend-design) and `@animae/preset-base`):

| Area | Policy keys | Authoring notes |
|------|-------------|-----------------|
| Appraisal / input class | `appraise.patterns`, `appraise.commands`, `appraise.fallback`, `appraise.inputClass` | Regex or keyword → `{type, intensity, …}`; `/thanks`-style commands |
| Render | `render.layers[]`, `render.fallback` | Pool lines with `when` (CEL), `text` (`$t:…` or template), optional `style: narration` / `narration_break` for speaker-less paragraphs |
| Choices | `choices.enabled`, `choices.count`, `choices.rules[]` | Quick replies when `when` holds; tag `expected_event_type` for appraisal |
| Memory write | `memory.writing.*` | Template text, importance/valence tables; `memory.writing.narration` controls whether narration enters NPC memory |
| Reflection | `reflection.backend`, `reflection.summaryTemplate` | Rule path uses template tables |
| Offscreen | `offscreen.narrateTemplate` | One-line location narration |
| Autonomous dialogue | `scene.autonomous.rules[]` | Idle lines between NPCs |

String-table keys (`$t:base.…`, `$t:rule.…`) must exist for every locale you ship; `animae validate --mode rule` checks playability and warns on missing keys.

### Narration (LLM and rule)

Speaker-less paragraphs are **not** character dialogue. In LLM render output they appear in `narrations[]` as `{ style, text }` (`normal` or `scene_break`). In the rule backend, pool lines use `style: narration` or `narration_break`. Each paragraph becomes a `narration` event and streams as `TurnChunk` `{ type: "narration", … }` before the character's `text`. Scene breaks are structural (dividers); they are not written to memory unless policy says otherwise.

---

## Validation rules (cross-reference)

- Duplicate ids across locations/items/fields/characters fail load.
- Policy `delta_table` keys must exist in merged `events.types`.
- Field `effects` keys must match `level`.
- CEL strings compile-checked at load (`celCheck`).
- Character directory name must match `identity.id` when set.

---

## SillyTavern cards

```bash
./dist/animae import-card ./card.json --root ./my-world
./dist/animae export-card npc-id --root ./my-world
```

See [modules/entities.md](./modules/entities.md).
