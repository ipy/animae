# Animae

Gameplay-agnostic character and world runtime for interactive narrative (TypeScript). Games such as [Lilium](../games/lilium) ship as separate workspace packages that depend only on the public `@animae/*` packages.

## Packages

| Package | npm name | Role |
|---------|----------|------|
| Engine | `@animae/engine` | Kernel: timeline, pipeline, rules, world, memory, RPC |
| Preset base | `@animae/preset-base` | Default policy bundle (`id: "@animae/preset-base"`) |
| Preset DnD | `@animae/preset-dnd` | SRD 5.2.1 overlay + social checks (`extends` base) |
| TUI | `@animae/tui` | Ink 8 components, default layout, theme, keymap |
| CLI | `animae` (`packages/cli`) | `init`, `validate`, `run`, `serve --stdio`, compiled binary |

## Requirements

- **Bun** ≥ 1.1 for development and `bun build --compile` (recommended for the single executable).
- **Node.js** ≥ 24 for running `@animae/engine` and the tsc-built CLI entry (`packages/cli/dist/bin.js`). Engine code uses only `node:*` APIs (no `Bun.*` in engine).

## Install (development)

From the repo root (see [root README](../README.md)):

```bash
bun install   # once, at lilium-monorepo root
```

Work inside `animae/` for engine-only changes:

```bash
cd animae
bun test
bun run typecheck
```

## Quick start

```bash
cd animae
bun run build
./dist/animae init ./my-world --preset '@animae/preset-base'
./dist/animae validate --root ./my-world
```

Add models before live play (see [getting-started.md](docs/getting-started.md)):

```yaml
# animae.yaml
models:
  s1: { provider: anthropic, model: claude-haiku-4-5 }
  s2: { provider: anthropic, model: claude-sonnet-4-5 }
```

```bash
./dist/animae run --root ./my-world              # Ink TUI
./dist/animae run --root ./my-world --plain      # line REPL + :commands
./dist/animae serve --stdio --root ./my-world    # JSON-RPC on stdin/stdout
```

Preset ids must match bundle ids exactly (e.g. `@animae/preset-base`, `@animae/preset-dnd`), not shorthand names like `base`.

## Build single executable

```bash
cd animae
bun run build
# → animae/dist/animae (~63 MB on macOS arm64; size varies by platform)
```

The build script runs `tsc` for the Node CLI when clean; on type errors it still produces the Bun-compiled binary (see `packages/cli/scripts/build.ts`).

## Licensing & DnD preset

`@animae/preset-dnd` includes material from the **SRD 5.2.1** (Wizards of the Coast), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/legalcode). Games using the preset must surface the attribution string:

```typescript
import { notice } from "@animae/preset-dnd";
// show notice in credits / :credits command
```

Full text is in `packages/preset-dnd/NOTICE` and the `notice` export.

## Documentation

- Index: [docs/README.md](docs/README.md)
- [Getting started](docs/getting-started.md) · [Authoring](docs/authoring-guide.md) · [Embedding](docs/embedding.md)
- [Product spec (中文)](docs/spec.md) · [Architecture](docs/architecture.md)

Module ownership: [docs/team-brief.md](docs/team-brief.md).
