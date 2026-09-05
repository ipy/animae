# CEL reference

Animae uses [@marcbachmann/cel-js](https://github.com/marc-bachmann/cel-js) **8.x** with `unlistedVariablesAreDyn: true` (missing keys → `null`). Expressions appear in policy YAML, authored scopes, beats, schedules, checks, and visibility-adjacent hooks.

Compile-time validation: every `Cel` schema field is checked via `celCheck()` at load.

## Numeric semantics

- Context numbers are adapted for cel-js: **safe integers → bigint**, fractional values → double.
- Results are converted back to JS numbers; integers outside `Number.MAX_SAFE_INTEGER` throw `CEL_EVAL`.
- Comparisons and arithmetic follow cel-js rules; use `maxInt(a,b)` when you need integer max with bigint operands.

## Standard context (`buildCelContext`)

Plain JSON-like objects; **never `undefined`** (missing → `null` / empty collections).

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
| `fields` | `{ active: [ids], <id>: true }` |
| `check` | Last roll `{ success, total, margin, ... }` or `null` |

Character `vars` and `world.vars` use a **dynamic map** proxy: reading a missing key yields `null` (not an error).

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
```

## Errors

Runtime evaluation failures throw `AnimaeError` code `CEL_EVAL` with the expression embedded in the message. Load failures use `CONFIG_INVALID` with file path.
