# @animae/tui

Ink 8 terminal UI for Animae games. See `animae/docs/modules/tui.md` for architecture and extension points.

## Quick start

```ts
import { runTui } from "@animae/tui";

await runTui({
  engine,
  scene: { location: "café", participants: ["player", "mira"] },
});
```

## Dev demo

```bash
cd animae/packages/tui && bun run scripts/demo.ts
```

## Build & test

```bash
bun run build
bun test
```
