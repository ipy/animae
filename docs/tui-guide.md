# TUI guide (`@animae/tui`)

Ink **8** + React 19 terminal UI used by `animae run` and embeddable via `runTui` in host applications.

## Entry

```typescript
import { runTui, defaultLayout, defaultTheme, defaultKeymap } from "@animae/tui";

await runTui({
  engine,
  viewer: "player",
  actor: "player",
  scene: { location: "home", participants: ["player", "guide"] },
  layout: defaultLayout,
  theme: defaultTheme,
  keymap: defaultKeymap,
  commands: { /* :colon handlers */ },
  panels: [/* side panel sections */],
});
```

## Components (`components/`)

| Component | Role |
|-----------|------|
| `Header` / `Footer` | Scene/time/status chrome |
| `Transcript` | Scrollback + typewriter |
| `InputLine` | Player input |
| `ChoiceMenu` | Numeric choices when policy enables |
| `SidePanel` | Participants, tracks, fields, anchors |
| Overlays | Help, event log, timeline, explain, inspector, load slots |

Replace via `layout`, `header`, `footer`, or `panels` on `RunTuiOptions`.

## Hooks (`hooks/`)

Exported from `@animae/tui` (see [21.6 API](./spec.md#216-api) plus layout helpers):

| Hook | Purpose |
|------|---------|
| `useEngine` | Engine handle from context |
| `useTurn` | Active turn stream / chunks |
| `useQuery` | Path reads via `engine.query` |
| `useEvents` | Timeline subscription |
| `useTheme` | Resolved theme patch |
| `useKeymap` | Merged keymap + bind helper |
| `useAppState` | Shell layout / overlay state |
| `useActionRunner` | Dispatch colon / toolbar actions |
| `useMouseTarget` | Mouse hit target (when enabled) |
| `useElementRect` | Measure panel geometry |

## Theme

`Theme`: colors, border style, `typewriter.{ enabled, charsPerSecond }`, `sidePanel.{ widthPercent, show[] }`, `bell`.

Load YAML patch:

```typescript
import { loadTheme } from "@animae/tui";
const theme = loadTheme("./my-theme.yaml");
```

Defaults: `theme/defaults.ts`.

## Keymap

Default bindings (`keymap/default.ts`):

| Action | Keys |
|--------|------|
| Submit | Enter |
| Choice up/down | ↑ / ↓ |
| Pick choice | `1`–`9` |
| Skip typewriter | `*` |
| Focus next | Tab |
| Page scroll | PageUp / PageDown |
| Help / log / timeline / explain / inspector | F1–F5 |
| Save / load / rewind / quit | Ctrl+S / Ctrl+L / Ctrl+Z / Ctrl+C |
| Close overlay | Escape |

Ctrl-chords only apply to save/load/rewind/quit. Override with `keymap: { help: ["h"], ... }`.

## Cues

Register renderers for structured cue types from utterances:

```typescript
import { createCueRegistry } from "@animae/tui";

const cues = createCueRegistry({
  expression: (cue, ctx) => `[${cue.args.name}]`,
});
```

Pass `cueRenderers` to `runTui`.

## Colon commands

`commands: Record<string, CustomCommand>` — each `{ description, usage?, run(args, api) }`.

Built-in when the engine was created with `modelCallLog`: **`:llmlog`** — last 10 calls; **`:llmlog <seq>`** — prompt + response for one entry; **`:llmlog dump`** — JSONL under `<data root>/llm-log/`. Disabled sessions show a localized warning. See [model-call-log.md](./model-call-log.md).

`CommandApi`: `engine`, `viewer`, `actor`, `sceneId()`, `startScene`, `endScene`, `notify`, overlays.

`useTurn` accumulates `TurnChunk` text with `applyTextTurnChunk` (one transcript/typewriter row per utterance, matching `@animae/host` stream semantics).

## Custom layout example

Minimal two-column swap (reuse default pieces):

```tsx
import { Box } from "ink";
import { components } from "@animae/tui";
const { Transcript, InputLine, SidePanel } = components;
import type { LayoutProps } from "@animae/tui";

export function MyLayout(props: LayoutProps) {
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" flexGrow={1}>
        <SidePanel viewer={props.viewer} engine={props.engine} />
        <Transcript {...props} />
      </Box>
      <InputLine {...props} />
    </Box>
  );
}
```

Pass `layout: MyLayout` to `runTui`. See `layout/default-layout.tsx` for responsive breakpoints (`selectLayoutMode`).

## QA assets

Frozen renders: [tui-snapshots/](./tui-snapshots/). Module notes: [modules/tui.md](./modules/tui.md).
