# Module: `@animae/preset-base` & `@animae/preset-dnd`

## Purpose

Built-in policy bundles ([19.4](../spec.md#194-animaepreset-base)–[19.6](../spec.md#196-animaepreset-rule)) shipped as npm packages. **Source of truth is YAML** under each package; `scripts/gen-bundle.ts` emits committed `src/generated.ts` for single-file executables (no runtime filesystem reads).

## Layout

```
packages/preset-base/
  preset.yaml              # id, extends, policies[]
  policies/base.yaml       # full base preset policy (Section 19.4)
  scripts/gen-bundle.ts
  src/generated.ts         # generated PresetBundle object
  src/index.ts             # export const preset + default

packages/preset-rule/
  preset.yaml              # extends @animae/preset-base; rule-first play ([19.6](../spec.md#196-animaepreset-rule))
  policies/rule.yaml
  locales/                 # string-table keys ($t:rule.*)

packages/preset-dnd/
  preset.yaml              # extends @animae/preset-base
  policies/dnd.yaml        # DnD preset overlays (Section 19.5): traits schema, checks, x.*
  knowledge/               # example exploration doc (check.success + approach)
  templates/fields/        # SRD condition YAML (authoring reference only; not merged into `PresetBundle.knowledge`)
  NOTICE                   # SRD 5.2.1 attribution (duplicate of `notice` export)
  src/math.ts, conditions.ts, rest.ts, rules.ts
```

Regenerate: `bun scripts/gen-bundle.ts` from the package directory. Tests assert `stableStringify(generated) === stableStringify(buildPresetBundleObject())`.

## Public API

### `@animae/preset-base`

| Export | Role |
|--------|------|
| `preset` / `default` | `PresetBundle` for `createEngine({ presets: [preset] })` |

Includes rule-backend defaults: `appraise.patterns` / `commands` / `fallback`, `render.layers` (utterance + narration), `choices.rules`, `memory.writing: { backend: rule, narration: none }`, full router degrade list ([Section 19.4](../spec.md#194-animaepreset-base)).

### `@animae/preset-rule`

| Export | Role |
|--------|------|
| `preset` / `default` | Extends base; enables choices, extra commands, memory valence tables, offscreen `narrateTemplate`, `scene.autonomous.rules` |

Use with `animae.yaml` `mode: rule` (or runtime preset `rule`) for zero-token play. String tables: `$t:rule.*` ([Section 19.6](../spec.md#196-animaepreset-rule), [i18n.md](../i18n.md)).

### `@animae/preset-dnd`

| Export | Role |
|--------|------|
| `preset` / `default` | Extended bundle + `rules()` registers `dndIntimidationExtra` |
| `notice` | Mandatory SRD 5.2.1 attribution string |
| `abilityModifier`, `proficiencyBonus`, `skillModifier`, `SKILL_ABILITIES` | SRD math helpers |
| `conditionField(name, params)` | `FieldDef` for Charmed / Frightened / Poisoned / Exhaustion |
| `rest(engine, "short"\|"long")` | 60 / 480 world minutes; long rest drops exhaustion one level |
| `dndIntimidationExtra`, `registerDndRules` | Rule fn (+2 track deltas on intimidation success) |

Policy data: `policy.x.approaches`, `policy.x.skills`, `policy.x.abilities` (18 SRD skills → ability keys).

## Visibility ([Section 19.4](../spec.md#194-animaepreset-base))

- **author / gm**: broad path globs (`characters/*/*`, `world/*`, `events`, …).
- **player**: `events` with kinds `utterance`, `narration`, `choice.offered`, `choice.taken`, `input.received`; optional deny rules on `events/narration` or `events/narration/style:scene_break`; `world/vars` (+ per-key rules; `world.public_vars` in authored data filters keys for `player`).
- **npc:\<id\>**: rules use the alias path prefix `characters/self` and `characters/self/*`. Introspect rewrites `characters/self/...` → `characters/<id>/...` before visibility and query (`resolveNpcSelfQueryPath` in `introspect/service.ts`). Globs cannot encode “only my id”; the alias plus rewrite is the supported pattern.

## CEL helpers (engine)

RPG presets rely on engine-registered CEL functions: `abilityMod(int)`, `profBonus(int)`, `maxInt(int,int)`. Intent `refuse` uses `self.hard_bottom_line_tags` (hard `bottom_lines` from the character card).

## Integrator notes

- Register `preset-dnd` rule fns before `loadPolicy`: pass `knownRuleFns: new Set(["dndIntimidationExtra"])`.
- `adjudicate` receives the last `check.rolled` payload so custom rules (intimidation extras) can read `check.success` in CEL.
- Charmed “charmer advantage on social checks” is only partially modeled (L2 `intent_forbid` on target; full L1 advantage on charmer may need scene-scoped fields).
- Exploration knowledge uses `inject: when` with `check.success && event.approach == "investigation"` (see `knowledge/exploration/example-clue.md`).
