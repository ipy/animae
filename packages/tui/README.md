# @animae/tui

Ink 8 terminal UI for Animae games. See [docs/modules/tui.md](../../docs/modules/tui.md) for architecture and extension points.

## Quick start

```ts
import { runTui } from "@animae/tui";

await runTui({
  engine,
  scene: { location: "café", participants: ["player", "mira"] },
});
// Footer: [RULE] or [S1:LLM S2:<tier>]; F6 / :mode for runtime mode; narration + reset in Transcript
```

## Dev demo

```bash
cd packages/tui && bun run scripts/demo.ts
```

## Build & test

```bash
bun run build
bun test
```
