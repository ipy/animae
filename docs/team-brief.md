# Team brief (read first)

You are one of ~17 engineers building, in parallel, **Animae** (a gameplay-agnostic character & world runtime for interactive narrative, TypeScript) and **Lilium** (a Chinese TUI TRPG-galgame on top of it). Repo root: `/Users/sin/work/animae/lilium` (bun workspaces monorepo; `animae/` is itself a publishable monorepo; `games/lilium` is the game).

## Read before coding
1. `animae/docs/spec.md` — the product spec (Chinese). The sections relevant to you are listed in your task. Follow it precisely; where it is silent, follow `animae/docs/architecture.md`.
2. `animae/docs/architecture.md` — conventions + pinned decisions (ids, tracks math, pipeline order, CEL context …).
3. Contract files (types only; do not break them): `animae/packages/engine/src/{types,ports,events,state,preset,api,contracts}.ts` and `src/schema/{common,authored,policy}.ts`.
4. For game work: `games/lilium/docs/design.md`.

## Working agreements
* Other agents are working **at the same time** in other directories. Edit only what you own (listed in your task). If you need a contract change, make a minimal ADDITIVE edit and append a line to the "Contract changelog" in `architecture.md`. If you need something from another module that doesn't exist yet, code against the interface in `contracts.ts` and test with a small local fake placed in YOUR test dir; look at the other module's directory later — it may have landed by then.
* Production quality: strict TS, robust error handling with `AnimaeError`, no mock/placeholder data in non-test code, no TODO stubs left in the shipped path. Tests with `bun test` (`import {test, expect} from "bun:test"`); test doubles allowed in tests only. Aim for thorough tests of every spec rule you implement (include edge cases).
* Check types with: `cd /Users/sin/work/animae/lilium && node_modules/.bin/tsc -p tsconfig.json --noEmit 2>&1 | grep -E "<your dir>"` (the repo-wide run may show errors from modules still in progress — ignore those, fix yours).
* Use the **context7 MCP** (`GetDynamicTools` namespace discovery → `CallDynamicTool`) to look up docs of libraries you aren't certain about: `ai` (Vercel AI SDK **v7**), `ink` **8**, `@marcbachmann/cel-js` **8.x**, `zod` **4**, `yaml`, `bun build --compile`. Don't guess APIs of these — v7/v8/v4 differ from older versions you may remember. You can also read `node_modules` type definitions.
* Dependencies: already installed for each package (ai, @ai-sdk/*, zod, cel-js, yaml; ink/react for tui/game). If you must add one: `cd <your package dir> && bun add <pkg>` (keep disk usage low; prefer Node built-ins). Never run a root-wide `bun install` while others work unless needed; never `git commit`.
* Engine code must be runtime-portable (Node ≥ 24 and Bun): only `node:*` APIs, no `Bun.*` in `@animae/engine`.
* Write/maintain a short doc `animae/docs/modules/<module>.md` for your module (purpose, public API, decisions, edge cases) — keep it updated at the end of your work. Game agents document in `games/lilium/docs/`.
* Do not stop early. Finish the full deliverable, make tests green, then return a concise final report: exported API (names + signatures), deviations from contracts/spec, known risks, and what the integrator must know.
* Style: small focused files, named exports, no default exports (except where a config module requires), no unused code, comments only for non-obvious reasoning.
