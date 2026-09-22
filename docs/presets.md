# Presets

A **preset** is a `PresetBundle`: `{ id, extends?, policies[], knowledge?, templates?, rules?, notice? }`. Built-ins:

| Id | Package |
|----|---------|
| `@animae/preset-base` | Default narrative policy ([Section 19.4](./spec.md#194-animaepreset-base)) |
| `@animae/preset-dnd` | Extends base; SRD checks & trait schema ([Section 19.5](./spec.md#195-animaepreset-dnd)) |

Register both via `createEngine({ presets: [...] })`. Set `animae.yaml`:

```yaml
preset: "@animae/preset-dnd"
policies:
  - policies/my-game.yaml
```

## Authoring a preset package

1. Create `packages/my-preset/` with `preset.yaml`:

```yaml
id: "@myorg/my-preset"
extends: "@animae/preset-base"
policies:
  - policies/core.yaml
```

2. Add policy YAML under `policies/`.
3. Optional `knowledge/`, `templates/`, `rules.ts` to register custom rule fns.
4. Run code generation:

```bash
cd packages/my-preset
bun scripts/gen-bundle.ts
```

5. Commit `src/generated.ts` (executables embed TS, not loose YAML).
6. Export `export const preset: PresetBundle = generatedBundle` from `src/index.ts`.

Tests should assert `stableStringify(generated) === stableStringify(buildPresetBundleObject())`.

## `gen-bundle` workflow

Each preset’s `scripts/gen-bundle.ts`:

- Reads `preset.yaml` and referenced policy files
- Converts knowledge markdown to embedded strings
- Embeds optional `locales/<locale>/strings.yaml` as flat `displayStrings` (policy `$t:dnd.check.*` keys resolve here)
- Emits a single `PresetBundle` object in `src/generated.ts`

Regenerate after any YAML change before release.

### Preset display strings (i18n)

- Policy YAML may use `$t:namespace.path` in **display-only** fields (check outcome copy, labels). The bundle generator lifts these to `{ i18n: { key } }` and ships matching entries in `displayStrings` for every supported UI locale (`en`, `zh-CN`).
- At runtime the engine merges `displayStrings` from the preset **extends** chain (`collectPresetDisplayStrings`); **later presets override earlier keys** per locale. Game data may add further overrides via locale string tables.
- Hosts expose merged preset tables to Web UI localization (`strings` namespace) so snapshots localize check copy before wire transfer; clients keep the same catalogs for `set_locale` rebinding.
- Hygiene: each preset package test-scans bundled policies for `$t` / `i18n` keys and asserts both locales in `displayStrings`; `@animae/preset-base` ships no display keys, `@animae/preset-dnd` ships SRD check outcome lines under `dnd.check.*`. **Authors:** every `$t:` key referenced in bundled policies must have entries under `locales/<lang>/strings.yaml` for each supported UI locale — CI runs i18n-key tests in `packages/preset-base/test` and `packages/preset-dnd/test`.

## Rule registration

If policy references `rules.custom[].fn` or schedule `rule:` names, register implementations before load:

```typescript
engine.rules.register("myRule", (ctx) => { ... });
await loadPolicy(..., { knownRuleFns: new Set(["myRule", "dndIntimidationExtra"]) });
```

Preset-dnd’s `rules()` hook registers `dndIntimidationExtra` automatically when the bundle is wired in `createEngine`.

## DnD / SRD attribution

`@animae/preset-dnd` exports `notice` (CC BY 4.0). Surface it in a host credits screen or colon command.

## Further detail

Implementation notes: [modules/presets.md](./modules/presets.md).
