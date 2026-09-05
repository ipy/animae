# CLI (`packages/cli`, npm name `animae`)

## Purpose

Operator-facing binary: scaffold data roots, validate config, run interactive sessions (TUI or `--plain`), timeline/card tools, and JSON-RPC stdio sidecar.

## Public API

| Export | Description |
|---|---|
| `runCli(argv, env): Promise<number>` | Testable entry (spec §20.3) |
| `parseCli`, `helpText` | Argument parsing |
| `validateDataRoot`, `openEngine` | Load helpers with built-in presets |

## Commands

`init`, `validate`, `run`, `inspect`, `timeline`, `import-card`, `export-card`, `serve --stdio` — global flags `--root`, `--model-mode`, `--seed`, `--version`, `--help` (accepted before **or after** the subcommand, e.g. `animae validate --root ./data`).

**Mods:** `mods list`, `mods validate [--mods a,b]`, `mods explain <path> [--mods a,b]`; `validate [--mods a,b]` loads layered authored data + policy. See [mods.md](../mods.md).

Built-in presets are loaded from `@animae/preset-base` and `@animae/preset-dnd` when those packages export `preset`.

## Build

From `animae/`:

```bash
bun run build
```

Produces:

- `animae/dist/animae` — `bun build --compile --minify` single executable (**66 104 546** bytes / ~63.0 MiB on macOS arm64, Bun 1.3.14; cold `--version` real ~1.3 s, warm ~0.09–0.20 s). Output path is `animae/dist/animae` (not under `packages/`). `--bytecode` is not used (top-level `await` in `bin.ts`). Pass `--target bun-linux-x64` via the build script argv passthrough.
- Built-in presets are **statically imported** in `src/presets.ts` (`@animae/preset-base`, `@animae/preset-dnd`) and pulled from `src/bin.ts` so the compiled binary does not rely on runtime `import(specifier)`. `BUILTIN_PRESET_BUNDLES` is resolved at module load for the bundler graph.
- `packages/cli/dist/bin.js` — Node ≥ 24 entry via `tsc` (`package.json` `"bin": { "animae": "./dist/bin.js" }`; verify with `node packages/cli/dist/bin.js --version`).

Do not add a direct `react-devtools-core` dependency (it creates a second `ink@8` peer tree in Bun’s store). Compiled binaries set `process.env.DEV='false'` via `ink-compile-options.ts` so Ink never loads devtools at runtime.

The compile script writes `--metafile=…` and runs `bundle-singleton-guard.ts`: more than one physical `react` / `ink` / `react-reconciler` path in the graph fails the build (prevents invalid hook calls in compiled TUI binaries). When the engine repo is embedded in a host monorepo, that host should hoist dependencies from its root (`animae/node_modules` must not coexist with the host’s root `node_modules`).

Release smoke from repo root: `bun run build:all && bun run smoke` (see `scripts/smoke.ts`, `scripts/animae-stdio-smoke.ts`). Ink packaging gate (unreachable LLM, base panel, `:help`/`:quit`): `python3 scripts/packaging-tui-verify.py`. PTY session with stub LLM: `python3 scripts/pty-smoke.py`.

`packages/cli/scripts/copy-docs.ts` copies `animae/docs/` into `animae/dist/docs` for publishing.

## Plain mode

Line-based REPL: streaming turn text, cues as `[expression: smile]`, colon commands aligned with TUI builtins (`:save`, `:load`, `:rewind`, …).

## Edge cases

- `init` refuses to overwrite an existing `animae.yaml`.
- `MODEL_CONFIG` / missing API keys: actionable stderr hint.
- `run` without `@animae/tui` `runTui` falls back to error message suggesting `--plain`.

## Tests

`packages/cli/test/` — args, init/validate on temp dirs, plain REPL, spawned `serve --stdio` integration.
