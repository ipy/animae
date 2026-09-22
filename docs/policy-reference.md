# Policy reference

A **policy document** is a partial YAML object validated by `PolicySchema` (`schema/policy.ts`). The loader deep-merges layers in order: preset `extends` chain → each path in `animae.yaml` `policies`. Output is a **resolved policy** with defaults filled.

## Merge semantics

| Value kind | Behaviour |
|------------|-----------|
| Objects | Deep merge by key |
| Scalars | Incoming replaces; prior value → `POLICY_OVERRIDE` warning |
| Arrays | **Replace** entirely |
| `{ $append: [...] }` | Concatenate after existing array |
| `{ $prepend: [...] }` | Concatenate before existing array |

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
| `custom` | array | `{ id, fn, when?, stage? }` — `stage`: `adjudicate` \| `tick` \| `scene_end` \| `scene_start` \| `daily` |

**CEL sites:** `windows[].trigger`, `thresholds[].when`, `custom[].when`.

### `intent`

| Key | Type |
|-----|------|
| `types` | string[] — vocabulary for `intent.decided` |

### `intent_rules`

Array of `{ intent, when, score }` — `when`: CEL bool; `score`: CEL or number.

### `input.response`

Keys: `injection_suspect`, `meta_probe` → `{ emit?, intent? }` or `{ hook: string }`.

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
| `weights.*` | term, recency, importance, salience, vector — partial |
| `k` | retrieval top-k |
| `recencyHalfLifeDays` | — |
| `indexMax` | — |
| `write.episodic` | `true` |
| `write.minIntensity` | `0.2` |
| `write.maxChars` | `240` |
| `forgetting.enabled` | `false`; `tau` 30; `threshold` 0.2 |
| `distortion.enabled` | `false`; `p` 0.1; `maxImportance` 0.7; `kinds` intensify/swap_subject/add_motive |
| `propagation.enabled` | `false`; `onTick` `day`; `distortionPerHop` 1 |

### `reflection`

| Field | Default |
|-------|---------|
| `enabled` | `true` |
| `accept` | `"!conflict"` (CEL) |

### `characters.lod.promote`

`{ from?, to, when }[]` — CEL on `when`.

### `offscreen.fidelity`

`default`: `none` \| `rule` \| `narrate` \| `full` (default `rule`); per-`locations` / per-`characters` overrides.

### `scene`

| Key | Default |
|-----|---------|
| `turnTaking` | `addressed` \| `round_robin` \| `{ priority: Cel }` |
| `autonomous.maxExchangesPerPlayerTurn` | `0` |
| `autonomous.when` | `"true"` |

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
| `syncCallsPerTurn` | `2` (appraise + render) |
| `s2PerTurn` | `1` |
| `s2Ratio` | `0.15` |
| `s2ReservedForAnchors` | `0.03` |
| `maxOutputTokens.s1` | `400` |
| `maxOutputTokens.s2` | `800` |
| `sceneS2Pool` | derived from ratio if omitted |
| `degrade` | e.g. `s2_to_s1`, `defer_reflection`, `skip_offscreen_narrate`, `skip_autonomous` |

### `render`

| Field | Default |
|-------|---------|
| `retryOnMismatch` | `0` |
| `recentTurns` | `12` |
| `temperature` | optional |
| `maxSegmentChars` | optional `{ static, semiStatic, dynamic }` caps |

### `cues.types`

`Record<type, { args: FieldDescriptor map, description? }>`.

### `choices`

| Field | Default |
|-------|---------|
| `enabled` | `false` |
| `count` | `3` |
| `filter` | `"true"` (CEL per choice) |

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
| Knowledge inject when | query-time context + **`model`** (`slot`, `tags` from active `ModelPort`) |

See [cel-reference.md](./cel-reference.md).
