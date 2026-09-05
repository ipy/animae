# Content mods

Mods are **optional content packs** (and optionally **code plugins** via embedded `ModBundle`) that overlay the data root without forking the base game. They are gameplay-agnostic: `rating` and `tags` are free metadata for host apps (e.g. example-game setup UI).

## Why mods vs presets vs authored vs plugins

| Mechanism | Purpose |
|-----------|---------|
| **Presets** | Engine-level mechanics bundles (`@animae/preset-*`), policy chains, shared templates/knowledge. Shipped inside the executable. |
| **Authored data** | The game’s canonical `world/`, `characters/`, `policies/` under the data root. |
| **Authored policy list** | Ordered YAML/TS overlays in `animae.yaml` `policies:` — deep-merge only for policy documents. |
| **Mods** | Optional packs under `mods/<id>/` (or embedded `ModBundle`) that **replace or patch** any authored path; toggled per session; recorded on the timeline for save/replay integrity. |
| **Code plugins** | Only via **`ModBundle.setup()`** registered by the host (or embedded bundle). **Never** auto-executed from disk in v1. |

## Layout

```
<root>/mods/<modId>/
  mod.yaml              # manifest (ModManifestSchema)
  world/...             # mirrors data root
  characters/<id>/...
  policies/...
  templates/...
```

Embedded bundle:

```typescript
import type { ModBundle } from "@animae/engine";

export const myMod: ModBundle = {
  manifest: { id: "my-mod", name: "…", version: "1.0.0" },
  files: { "world/locations/extra.yaml": "id: extra\n…" },
  setup(ctx) {
    ctx.rules.register("my_rule", (c) => []);
  },
};
```

Generate TS from a directory: `bun scripts/gen-mod-bundle.ts` (see `packages/engine/scripts/gen-mod-bundle.ts`).

## Manifest (`mod.yaml`)

| Field | Required | Description |
|-------|----------|-------------|
| `id` | yes | kebab-case; must match directory name |
| `name` | yes | display name |
| `version` | yes | semver |
| `description` | no | text |
| `engine` | no | semver range vs `@animae/engine`; mismatch → warning |
| `requires` | no | other mod ids or preset ids (`@animae/preset-base` skips mod resolution) |
| `conflicts` | no | incompatible mod ids |
| `loadAfter` | no | topological hint (load after these mods) |
| `rating` | no | free string (e.g. `optional`) |
| `tags` | no | string[] |
| `notice` | no | text host should show before enable |
| `provides` | no | string[] capability labels |

## Layering order

1. Engine defaults (policy fill)
2. Presets (`extends` chain → preset policies → templates/knowledge)
3. Base authored files on disk
4. **Enabled mods** — resolved order: topological sort of `requires` + `loadAfter`, then `animae.yaml` / `createEngine` enable order

Same logical path: **later layer wins** (full file replace). **`*.patch.yaml`** deep-merges into the target. Character **`card.patch.yaml`** merges frontmatter; **`card.append.md`** appends to persona body.

### Patch operators

Same as policy merge, plus:

| Operator | Meaning |
|----------|---------|
| `$append: [...]` | append to array |
| `$prepend: [...]` | prepend to array |
| `$replace: [...]` | replace entire array |
| `$remove: [...]` | remove by value or `{ id }` |
| `{ $delete: true }` | delete object key |

Example `world/locations/tavern.patch.yaml`:

```yaml
summary: overridden
tags:
  $append: [modded]
```

## Activation

`animae.yaml`:

```yaml
mods:
  - demo-mod
```

Host override:

```typescript
createEngine({
  root,
  mods: ["demo-mod"], // or [{ id: "demo-mod", enabled: true }]
  modBundles: [embeddedMod],
});
```

Missing / conflicting / unsatisfied deps → `AnimaeError("MOD_CONFIG")`.

## Determinism & saves

Enabled mods `{ id, version, contentHash }` are stored on `config.reloaded` (and in `EngineState.config.mods`). The mod set is included in authored hash (`__mods__` entry). If a loaded timeline’s recorded mods differ from the current set, the engine emits `config.warning` (`mod_drift`). Use `engine.mods()` for `{ mods, drift, provenance }`.

Filesystem mods are **data-only**. Only registered `ModBundle.setup()` runs code.

### CEL guards (optional world vars)

Indexing a missing key as `world.vars['some.key']` throws at runtime. For optional flags (pairs, milestones), test membership first: `'some.key' in world.vars && world.vars['some.key'] == true`.

**Host bundles with empty `files`:** When a registered `ModBundle` has no embedded overlay files, the engine still loads overlay content from `mods/<id>/` on disk (manifest comes from the bundle). Use this for code-only plugins (e.g. host-registered optional mod rule hooks).

## Security (v1)

- Treat `mods/**` on disk as untrusted **data** (YAML/MD only).
- Do not execute scripts from mod directories.
- Code runs only from explicit `modBundles` the host registers.

## CLI

```bash
animae mods list [--root DIR]
animae mods validate [--mods a,b]
animae mods explain world/locations/tavern.yaml
animae validate [--mods a,b]
```

## Example

See [examples/mods/demo-pavilion/](./examples/mods/demo-pavilion/).
