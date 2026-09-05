# Presets

A **preset** is a `PresetBundle`: `{ id, extends?, policies[], knowledge?, templates?, rules?, notice? }`. Built-ins:

| Id | Package |
|----|---------|
| `@animae/preset-base` | Default narrative policy (spec §19.4) |
| `@animae/preset-dnd` | Extends base; SRD checks & trait schema (§19.5) |

CLI and example-game register both via `createEngine({ presets: [...] })`. Set `animae.yaml`:

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
- Emits a single `PresetBundle` object in `src/generated.ts`

Regenerate after any YAML change before release.

## Rule registration

If policy references `rules.custom[].fn` or schedule `rule:` names, register implementations before load:

```typescript
engine.rules.register("myRule", (ctx) => { ... });
await loadPolicy(..., { knownRuleFns: new Set(["myRule", "dndIntimidationExtra"]) });
```

Preset-dnd’s `rules()` hook registers `dndIntimidationExtra` automatically when the bundle is wired in `createEngine`.

## DnD / SRD attribution

`@animae/preset-dnd` exports `notice` (CC BY 4.0). Surface in credits UI — example-game `:credits` command prints it.

## Further detail

Implementation notes: [modules/presets.md](./modules/presets.md).
