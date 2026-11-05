# CEL reference

Animae uses [@marcbachmann/cel-js](https://github.com/marc-bachmann/cel-js) **8.x** with `unlistedVariablesAreDyn: true`. Expressions appear in policy YAML, authored scopes, beats, schedules, checks, and visibility-adjacent hooks.

Compile-time validation: every `Cel` schema field is checked via `celCheck()` at load.

## Runtime evaluation

In-turn CEL (`policy.when`, intent scores, choice filters, knowledge `when`, field scopes, etc.) must evaluate without error. Failures throw **`CEL_EVAL`** and **fail the current turn** (`turn.ended` with error; no half-committed pipeline state). Guard optional map keys and seed `world.yaml` `vars:` — [spec Section 7.4](./spec.md#74-loading-and-validation), [Map keys](#map-keys-worldvars-character-vars) below.

## Numeric semantics

- Context numbers are adapted for cel-js: **safe integers → bigint**, fractional values → double.
- Results are converted back to JS numbers; integers outside `Number.MAX_SAFE_INTEGER` throw `CEL_EVAL`.
- Comparisons and arithmetic follow cel-js rules; use `maxInt(a,b)` when you need integer max with bigint operands.
- **Arithmetic does not mix integers and doubles**, and which kind a context number is depends on its value: `35` is an integer, `35.5` a double. `tracks.affinity + 1` therefore fails with `CEL_EVAL` while the track is fractional, and `tracks.affinity * 1.5` while it is whole. Convert first — `double(tracks.affinity) * 1.5`, `int(tracks.affinity) + 1` — or keep to comparisons (`<`, `>`, `==`), which accept both kinds.

## Standard context (`buildCelContext`)

Plain JSON-like objects; **never `undefined`** (missing top-level bindings → `null` / empty collections).

| Variable | Shape |
|----------|--------|
| `self` | NPC under evaluation: `{ id, name, lod, tags[], traits{}, vars{}, interactions, location, hard_bottom_line_tags[] }` |
| `other` | Counterpart character (same shape) |
| `actor` | Event actor (same shape) |
| `event` | `{ type, intensity, sincerity, approach, tags[], claims[], input_class, positive, text }` |
| `scene` | `{ id, location, participants[], turn, first, count }` |
| `world` | `{ vars{}, time{day,minute,hour,minutes}, chapter, location, minutes }` — `location` is player location |
| `time` | `{ day, minute, hour, minutes }` |
| `tracks` | `{ <trackName>: effective number }` toward `other` (offsets applied) |
| `tiers` | `{ <trackName>: tierName \| null }` |
| `memory` | `{ count }` (+ retrieval helpers in some call sites) |
| `fields` | `{ active: [ids], <id>: true, event_prob: Record<eventTypeId, Δ> }` — aggregated L0 `event_prob` shifts (empty object when none) |
| `check` | Last roll `{ success, total, margin, ... }` or `null` |
| `model` | Active model context: `{ kind: "s1" \| "s2" \| "rule" \| "", tier?, tags: string[] }` — see below |

### `model` (knowledge `when:` and prompt assembly)

Always present ([Section 7.2](./spec.md#72-cel-context-variables)) in contexts built for **knowledge inject `when`**, render choice filters, and prompt assembly:

| Field | Meaning |
|-------|---------|
| `model.kind` | `s1` or `s2` when an LLM serves that role; `rule` on the rule backend; `""` on pure-rule stages unless the host passes `extra.model` |
| `model.tier` | S2 tier id during an LLM S2 call (absent for S1 and rule) |
| `model.tags` | Capability tags from the active `ModelPort` or S2 tier config (`models.s2.tiers[].tags`); **empty** under the rule backend |

Test membership with `'premium' in model.tags` or `model.kind == 's2'`. Tag-gated knowledge should guard with `'tag' in model.tags` so rule-mode play still receives untagged content.

Example knowledge frontmatter:

```yaml
inject: when
when: "model.kind == 's2' && 'content:mature' in model.tags && tracks.trust >= 30"
```

### Map keys (`world.vars`, character `vars`)

Indexing or selecting a **missing map key** (including `world.vars['k']` and `self.vars['k']`) is a **runtime error** (`CEL_EVAL`, “No such key …”). cel-js uses `Object.hasOwn` on the map object, so absent keys are not coerced to `null`.

- Test presence before read: `'k' in world.vars && world.vars['k'] == true` (the guard is also required before numeric comparisons, because `null` is not comparable to numbers).
- **Best practice:** declare initial values under `vars:` in `world.yaml` (they seed every branch, rewind, and import) so the key always exists.
- Mods can add initial vars through a `world/world.patch.yaml` patch.

See also [mods.md — CEL guards](./mods.md#cel-guards-optional-world-vars).

### `self.hard_bottom_line_tags`

Tags from the character card `constraints.bottom_lines` where `hardness: hard`. Used by preset intent rules (e.g. refuse when event tags hit a hard line):

```cel
event.tags.exists(t, t in self.hard_bottom_line_tags)
```

## Extra keys (call-site specific)

Merged from `celContext({ extra: { ... } })`:

| Key | Used for |
|-----|----------|
| `time` | Override clock during schedule/world.advance simulation |
| `schedule` | `{ id }` on scheduled fires |
| `field`, `payer` | Field cost settlement |
| `choice` | Choice filtering in render |
| `goal`, `conflict`, `proposal` | Reflection / memory |
| `thresholdId` | Threshold rules |
| `anchor_ref` | Promotion hints |
| `gallery.unlocked` | Preset ids already unlocked (gallery unlock / rating CEL) |
| `turn.kinds` | Event kinds committed in the current turn (gallery unlock after turn) |
| `image.tags` | `ImagePort.tags` strings (empty when no port); e.g. `'tier:restricted' in image.tags` |

Gallery-specific usage is documented in [gallery.md](./gallery.md#cel-context-gallery-hooks).

## Registered functions (engine)

Defined in `rules/cel.ts` (always available):

| Function | Signature | Semantics |
|----------|-----------|-----------|
| `abilityMod` | `(int): int` | D&D ability modifier: `floor((score - 10) / 2)` |
| `profBonus` | `(int): int` | Proficiency: `2 + floor((level - 1) / 4)` |
| `maxInt` | `(int, int): int` | Larger of two integers |

TypeScript helpers on `@animae/preset-dnd` (`abilityModifier`, `proficiencyBonus`, `skillModifier`) mirror SRD math for tests and tooling; **policy checks should use CEL names above**.

## CEL-JS built-ins

Standard cel-js functions apply (`size()`, `exists`, `matches`, string ops, etc.). Prefer explicit comparisons; string concatenation in check `expr` often uses `+` with `string(...)` coercions (see preset-dnd checks).

## Examples

```cel
tracks.trust >= 40 && event.intensity > 0.5
scene.first && fields.active.exists(f, f == "welcome-boost")
time.day >= 55 && time.day <= 62
check.success && event.approach == "investigation"
"1d20+" + string(abilityMod(actor.traits.abilities.CHA))
maxInt(15, self.traits.abilities.INT)
'feature.on' in world.vars && world.vars['feature.on'] == true
```

Further reading: [policy-reference.md](./policy-reference.md), [modules/rules.md](./modules/rules.md).
