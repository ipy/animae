# Animae

Gameplay-agnostic character and world runtime for interactive narrative (TypeScript). Host applications depend only on the public `@animae/*` packages published from this repository.

## Packages

| Package | npm name | Role |
|---------|----------|------|
| Engine | `@animae/engine` | Kernel: timeline, pipeline, rules, world, memory, RPC, optional CG gallery (`ImagePort`) |
| Preset base | `@animae/preset-base` | Default policy bundle (`id: "@animae/preset-base"`) and rule-backend templates (appraisal, render layers, choices) |
| Preset rule | `@animae/preset-rule` | Rule-first overlay: quick replies, extra commands, offscreen/autonomous rule text ([spec Section 19.6](docs/spec.md#196-animaepreset-rule)) |
| Preset DnD | `@animae/preset-dnd` | SRD 5.2.1 overlay + social checks (`extends` base) |
| TUI | `@animae/tui` | Ink 8 components, default layout, theme, keymap |
| CLI | `animae` (`packages/cli`) | `init`, `validate`, `run`, `serve --stdio`, compiled binary |

## Requirements

- **Bun** ≥ 1.1 for development and `bun build --compile` (recommended for the single executable).
- **Node.js** ≥ 24 for running `@animae/engine` and the tsc-built CLI entry (`packages/cli/dist/bin.js`). Engine code uses only `node:*` APIs (no `Bun.*` in engine).

## Install (development)

The repository root is a Bun workspace (`packages/*`):

```bash
bun install
bun test
bun run typecheck
```

## Quick start

```bash
bun run build
./dist/animae init ./my-world --preset '@animae/preset-base'
./dist/animae validate --root ./my-world
```

**Play with no LLM** (zero tokens, deterministic rule backend):

```bash
./dist/animae init ./offline --preset '@animae/preset-rule'
./dist/animae validate --root ./offline --mode rule
./dist/animae run --root ./offline --mode rule
```

Add models when you want live generation (see [getting-started.md](docs/getting-started.md)). S1 and S2 are **roles** (structured judgment vs free-text); each can run on an LLM or the rule backend, and you can switch at runtime (`--mode`, `:mode`, `runtime.setMode`):

```yaml
# animae.yaml (excerpt)
mode: llm                        # llm | hybrid | rule
models:
  s1: { provider: anthropic, model: claude-haiku-4-5 }
  s2:
    default: std
    tiers:
      - { id: std, provider: anthropic, model: claude-sonnet-4-5 }
    routing: { render: std, offscreen: std, autonomous: std }
runtime:
  switchAt: turn_boundary
  fallbackOnError: { appraise: true, render: true }
```

```bash
./dist/animae run --root ./my-world              # Ink TUI
./dist/animae run --root ./my-world --plain      # line REPL + :commands
./dist/animae serve --stdio --root ./my-world    # JSON-RPC on stdin/stdout
```

Preset ids must match bundle ids exactly (e.g. `@animae/preset-base`, `@animae/preset-rule`, `@animae/preset-dnd`), not shorthand names like `base`.

## Build single executable

```bash
bun run build
# → dist/animae (~63 MB on macOS arm64; size varies by platform)
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
- [Getting started](docs/getting-started.md) · [Authoring](docs/authoring-guide.md) · [Embedding](docs/embedding.md) · [CG gallery](docs/gallery.md)
- [Product specification](docs/spec.md) · [Architecture](docs/architecture.md)
- [Internationalization](docs/i18n.md): the engine ships English; other languages arrive as locale packs from the embedding project
