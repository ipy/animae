# Policy reference

A **policy document** is a partial YAML object validated by `PolicySchema` (`schema/policy.ts`). The loader deep-merges layers in order: preset `extends` chain → each path in `animae.yaml` `policies`. Output is a **resolved policy** with defaults filled.

## Merge semantics

| Value kind | Behaviour |
|------------|-----------|
| Objects | Deep merge by key |
| Scalars | Incoming replaces; prior value → `POLICY_OVERRIDE` warning |
| Arrays | **Replace** entirely |
| `{ $append: [...] }` | Concatenate after existing array, or after existing **string** |
| `{ $prepend: [...] }` | Concatenate before existing array, or before existing **string** |

---

## Top-level keys

### `schema.extend` (optional)

Extends Zod validation for authored/event payloads.

| Path | Value |
|------|--------|
| `traits` | `Record<string, FieldDescriptor>` |
| `character` | extra card/character fields |
| `world` | extra world fields |
| `event` | nested map of event-type → field descriptors |

### `events.types`

`Record<eventType, { positive?: bool, description?, label? }>` — `positive` drives sincerity factor in delta formula; unknown appraisal types become `other`.

### `tracks`

`Record<trackId, TrackDef>`:

| Field | Type | Default |
|-------|------|---------|
| `scope` | `self` \| `relation` | `relation` |
| `label` | string | — |
| `min`, `max`, `initial` | number | required |
| `tiers` | `{ name, from }[]` | `[]` |
| `hysteresis` | number ≥ 0 | `0` |
| `decay` | `{ toward, ratePerHour }` | — |

### `rules`

| Key | Type | Notes |
|-----|------|-------|
| `delta_table` | `Record<eventType, Record<track, number>>` | Base Δ before caps |
| `marginal` | `{ k, halfLifeHours }` | Diminishing returns |
| `turn_cap` | `Record<track, positive>` | Max \|Δ\| per turn per track |
| `windows` | array | `{ id, trigger, durationScenes, mult, capToLoss? }` |
| `thresholds` | array | `{ id, when, emit, repeat? }` |
| `custom` | array | `{ id, fn, when?, stage? }` — `stage`: `adjudicate` \| `scene_end` \| `scene_start` \| `daily` (`tick` rejected at load; schedule items use tick ctx separately) |

**CEL sites:** `windows[].trigger`, `thresholds[].when`, `custom[].when`.

### `intent`

| Key | Type |
|-----|------|
| `types` | string[] — vocabulary for `intent.decided` |

### `intent_rules`

Array of `{ intent, when, score }` — `when`: CEL bool; `score`: CEL or number.

### `input.response`

Keys: `injection_suspect`, `meta_probe` → `{ emit?, intent? }` or `{ hook: string }` (registered rule id).

**Static mapping:** after appraise, the pipeline applies `emit` (appraisal event type override) and `intent` (forces `intent.decided`) before check/adjudicate.

**Hook (`hook`):** runs once at the same boundary (stage `classify`, RNG key `classify:<turnId>:<class>`). CEL context includes `event` (appraisal + `event.text` = player line). Returned drafts append with source `rules:classify`. To override intent or appraisal without extra timeline noise, include `intent.decided` or `appraisal` drafts in the return value; those are applied locally and not re-appended.

### `memory.weights.vector`

Default in `applyPolicyDefaults({})` is **0.3** (used when embeddings are enabled). `@animae/preset-base` sets `vector: 0` so vector blending is opt-in via preset merge.

### `safety`

| Field | Default |
|-------|---------|
| `enabled` | `false` |
| `response` | `in_character` — also `out_of_character_notice`, `block`, `hook:<name>` |
| `log` | `false` |

### `fields`

| Key | Notes |
|-----|-------|
| `grants` | `{ holder: Cel, source: Cel, maxLevel }[]` — max field level by holder/source |
| `caps` | map of effect key → max absolute magnitude (`salience.boost`, `track_offset`, …) |

**CEL sites:** `grants[].holder`, `grants[].source`.

### `memory`

| Path | Default / notes |
|------|-----------------|
| `weights.*` | term 0.5, recency 0.2, importance 0.2, salience 0.1, vector 0.3 — partial merge |
| `k` | `8` |
| `recencyHalfLifeDays` | `7` |
| `indexMax` | `50` |
| `write.episodic` | `true` |
| `write.minIntensity` | `0.2` |
| `write.maxChars` | `240` |
| `writing.backend` | `rule` — or `s1` for LLM `{text, importance, valence}` when S1 is on a model |
| `writing.template` | `"{{text}}"` (CEL; `text` = utterance, `speaker` = speaker id) |
| `writing.importanceByEventType` / `writing.valenceByEventType` | maps per appraised event type (rule path) |
| `writing.narration` | `none` \| `inject_belief` \| `shareable` — whether speaker-less `narration` events become memory ([Section 9.1](./spec.md#91-memory-entries)) |
| `forgetting.enabled` | `false`; `tau` 30; `threshold` 0.2 |
| `distortion.enabled` | `false`; `p` 0.1; `maxImportance` 0.7; `kinds` default `[intensify]` |
| `propagation.enabled` | `false`; `onTick` `day` (propagate on day boundary in `world.advance`) or `scene_end` (propagate when a scene ends); `distortionPerHop` 1 |

**CEL:** `memory.writing.template`.

### `appraise` (rule backend)

Used when the S1 role is served by the rule backend (or as fallback). Priority: taken choice metadata → `/command` → `patterns[]` → `fallback`.

| Field | Notes |
|-------|--------|
| `patterns[]` | `{ match, flags?, event: { type, intensity?, sincerity?, approach?, tags? } }` |
| `fallback` | same shape as pattern `event` |
| `commands` | map command word → event type id |
| `inputClass.injection` / `inputClass.metaProbe` | regex sources (case-insensitive) extending default keyword tables |

### `reflection`

| Field | Default |
|-------|---------|
| `enabled` | `true` |
| `accept` | `"!conflict"` (CEL) |
| `backend` | `s1` — follows S1 role (`llm` when a model serves S1, else rule); `rule` forces template path |
| `summaryTemplate` | optional CEL template for rule-backend summary only |

### `characters.lod.promote`

`{ from?, to, when }[]` — CEL on `when`.

### `offscreen`

| Field | Default / notes |
|-------|-----------------|
| `fidelity.default` | `rule`; per-`locations` / per-`characters` overrides: `none` \| `rule` \| `narrate` \| `full` |
| `narrateTemplate` | optional CEL template for rule-backend location traces (`location.name`, `time`) when fidelity is `narrate` or `full` |

### `scene`

| Key | Default |
|-----|---------|
| `turnTaking` | `addressed` \| `round_robin` \| `{ priority: Cel }` |
| `autonomous.maxExchangesPerPlayerTurn` | `0` |
| `autonomous.when` | `"true"` |
| `autonomous.rules` | optional rule-backend template layers (same shape as `render.layers`) for NPC–NPC dialogue |

**CEL:** `turnTaking.priority`, `autonomous.when`.

### `router.triggers`

Each trigger: `{ enabled: true, ...params }`:

| Trigger | Extra params |
|---------|----------------|
| `anchor_near` | `n` (default 1) |
| `mood_spike` | `a` 30, `b` 80, `track` `mood` |
| others | `enabled` only |

### `router.budget`

| Field | Default |
|-------|---------|
| `syncCallsPerTurn` | `2` (at most one S1 + one S2 LLM call before the player sees the reply) |
| `s1PerTurn` | `1` — `0` forces appraise on the rule backend for that turn |
| `s2PerTurn` | `1` — default cap per S2 tier when `s2PerTurnByTier` has no entry |
| `s2PerTurnByTier` | optional `{ <tierId>: n }` — `0` disables a tier |
| `s2Ratio` | `0.15` — share of turns that may run above the default S2 tier |
| `s2ReservedForAnchors` | `0.03` — fraction of the scene escalation pool reserved for `anchor_near` |
| `maxOutputTokens.s1` | `400` |
| `maxOutputTokens.s2` | `800` or per-tier map |
| `sceneS2Pool` | optional; else derived from participants × `s2Ratio` |
| `degrade` | when omitted or empty at runtime, `[s2_tier_down, s2_to_rule, s1_to_rule, defer_reflection, skip_offscreen_narrate, skip_autonomous]` ([Section 17.4](./spec.md#174-degradation)) |

### `render`

| Field | Default |
|-------|---------|
| `retryOnMismatch` | `0` |
| `recentTurns` | `12` |
| `temperature` | optional |
| `maxSegmentChars` | optional `{ static, semiStatic, dynamic }` caps |
| `knowledgeIndexMax` | optional cap on lines in the on-demand knowledge index (S2 with tools only) |
| `relation` | optional display config for the compact relation line, see below |
| `recall.maxKnowledge` | `3` — max recalled knowledge docs in the dynamic segment |
| `recall.knowledgeChars` | `280` — per-doc trim near this length (sentence boundary) |
| `recall.memoryChars` | `400` — per recalled memory trim |
| `layers` | rule backend: ordered template layers (`when`, weighted pool lines; `style: narration` \| `narration_break` for speaker-less paragraphs) |
| `fallback` | rule backend utterance when no layer matches |

Backends for the S1/S2 **roles** (`llm` vs `rule`) are set in `animae.yaml` (`mode`, `appraise.backend`, `render.backend`) or `Engine.runtime.setMode`, not in policy.

#### `render.relation`

Controls the `- <name>: <track> <tier>, ... — <directive>` line that every prompt carries per other participant. Every key is optional.

| Field | Default |
|-------|---------|
| `tracks` | every relation-scope track, in policy order; the line may show only these, in this order |
| `maxTracks` | `3` |
| `silentTiers` | `{ <track>: [tier, ...] }` tiers left out of the line; by default the tier a track starts in (the one holding `initial`) is left out because it is not news |
| `directiveTracks` | same as `tracks`; consulted for `x.tier_directives` |
| `maxDirectives` | `1`; directives come from the tracks that moved furthest from their starting tier, ties keep the configured order |

### `cues.types`

`Record<type, { args: FieldDescriptor map, description? }>`.

### `choices`

| Field | Default |
|-------|---------|
| `enabled` | `false` |
| `count` | `3` |
| `filter` | `"true"` (CEL per choice) |
| `rules` | rule backend: `{ when, text, event_type, tags?, intensity?, sincerity?, approach? }[]` — quick replies when enabled |

### `timeline`

| Field | Default |
|-------|---------|
| `allowRewind` | `true` |
| `carry` | `{ characters, kinds, tags, when }[]` — kinds: `memory`, `track`, `world_var` |

**CEL:** `carry[].when`.

### `visibility.rules`

Ordered list; **last match wins**; no match → deny.

`{ viewer, path, allow, kinds? }` — viewer id or glob; path glob; optional event kind globs for `events` paths.

### `checks`

Array of `{ id, when, expr, dc, advantage?, disadvantage?, skill?, onSuccess?, onFailure? }`.

**CEL:** `when`, `expr` (dice string), `dc`, advantage/disadvantage.

### `x`

Free-form map; readable in rule functions as `ctx.policy.x` (via kernel). Hosts store balance tables here (e.g. `policy.x.jobs` in a host policy overlay).

#### `x.prompt` (host conventions)

Games often nest prompt tuning under `policy.x.prompt`:

| Key | Role |
|-----|------|
| `world_facts` | Static world tone and safety defaults (merged into the **static** render segment) |
| `render` | Render-only narration guidance (choices wording, scene voice) |
| `choices` | Event-type and tag vocabulary for the choices block in the output contract |
| `appraise_static` | Appraise-only static block (no world rules or render narration partials) |
| `appraise_examples` | Few-shot appraise examples |
| `template_partials` | Template ids merged into **render** prompts only; appraise assembly skips their narration bodies |

Knowledge docs use frontmatter `inject: always | when | on-demand`; `when` is CEL over `event.type`, `scene.participants`, `world.vars`, and `model.kind` / `model.tier` / `model.tags` ([Section 7.2](./spec.md#72-cel-context-variables)).

### `animae.yaml` (not policy): models and runtime

| Key | Role |
|-----|------|
| `models.s1` | S1 LLM spec, or `{ provider: rule }` / omitted → rule backend |
| `models.s2` | tier ladder `{ default, tiers[], routing }` or single model → one tier `only` |
| `mode` | `llm` \| `hybrid` \| `rule` — initial runtime preset ([Section 19.3](./spec.md#193-model-configuration)) |
| `appraise.backend` / `render.backend` | per-role backend override in `hybrid` |
| `runtime.switchAt` | `turn_boundary` (default) \| `immediate` |
| `runtime.fallbackOnError.*` | per phase (`appraise`, `render`, `reflection`, `entity`, `memoryWrite`, `offscreen`, `autonomous`); default all `false` |

---

## CEL availability summary

| Site | Typical context |
|------|-----------------|
| Beats enter/exit | `world`, `time`, `fields`, `tracks` (no event) |
| Field scope.when | full turn context when resolving |
| Schedule.when | `time`, `schedule`, `world` |
| Thresholds / windows / custom | event + tracks + scene |
| Intent rules | event + self/other + `self.hard_bottom_line_tags` |
| Checks | event + actor/self/other + `check` after roll |
| Choices.filter | per-choice `choice` extra |
| Reflection.accept | `conflict`, memory helpers |
| Knowledge inject when | query-time context + **`model`** (`kind`, `tier?`, `tags` from active backend) |

See [cel-reference.md](./cel-reference.md).
