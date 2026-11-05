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
| Overlays | Help, event log, timeline, explain, inspector, **mode (F6)**, load slots |

Replace via `layout`, `header`, `footer`, or `panels` on `RunTuiOptions`.

## Hooks (`hooks/`)

Exported from `@animae/tui` (see [21.6 API](./spec.md#216-api) plus layout helpers):

| Hook | Purpose |
|------|---------|
| `useEngine` | Engine handle from context |
| `useTurn` | Active turn stream / chunks |
| `useQuery` | Path reads via `engine.queryAsync` when `viewer` is `player`, else `engine.query` (keeps prior data while refreshing; ignores stale async results) |
| `useEvents` | Timeline subscription |
| `useRuntimeMode` | Current/pending runtime mode, `switchAt`, and `models()` info for the footer / mode panel |
| `useTheme` | Resolved theme patch |
| `useKeymap` | Merged keymap + bind helper |
| `useAppState` | Shell layout / overlay state |
| `useActionRunner` | Dispatch colon / toolbar actions |
| `useMouseTarget` | Mouse hit target (when enabled) |
| `useElementRect` | Measure panel geometry |

## Theme

`Theme`: colors (include `narration` for speaker-less paragraphs), border style, `typewriter.{ enabled, charsPerSecond }`, `sidePanel.{ widthPercent, show[] }`, `bell`.

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
| Help / log / timeline / explain / inspector / **mode** | F1–F6 (**Alt+1–6** on macOS) |
| Save / load / rewind / quit | Ctrl+S / Ctrl+L / Ctrl+Z / Ctrl+C |
| Close overlay | Escape |

Ctrl-chords only apply to save/load/rewind/quit. Override with `keymap: { help: ["h"], ... }`.

Ctrl+L lists the saves (↑ / ↓ stop at the ends of the list); Enter loads the highlighted slot, closes the list and reports `Loaded <label>`. Ctrl+Z asks for confirmation and then forks a new branch at the event just before your last turn started, so that turn is undone and the old branch stays on the timeline; with no turn played it says so. When the engine refuses a timeline action (for example `timeline.allowRewind: false`), the reason is printed in the transcript.

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

Built-in **`:gallery`** opens the CG gallery overlay (or subcommands `list`, `show`, `capture`, `render`, … — same as `@animae/host`). In the overlay: ↑↓ select, Enter reveal masked rows, `c` capture, `r` render, `x` cancel job, `o` open image path, `p` pin captured entry, `d` delete captured (confirm), Esc close. Pass `galleryPresentation: (item) => ({ blur: item.rating !== "general" })` and `openFile` on `RunTuiOptions` for restricted masking and OS viewing. See [gallery.md](./gallery.md).

`CommandApi`: `engine`, `viewer`, `actor`, `sceneId()`, `startScene`, `endScene`, `notify`, overlays.

`useTurn` (via `consume-turn.ts`) accumulates `text` and `narration` chunks into transcript rows, handles `reset` by removing in-flight output (keeping the player's echo), and shows system lines on `runtime.mode_changed` / `runtime.fallback_used`.

## Runtime mode UI

| Surface | Behaviour |
|---------|-----------|
| Footer | `[RULE]` when both roles use rules; otherwise `[S1:LLM S2:<tier>]` (or `S2:RULE`, `S1:RULE S2:<tier>`). Queued turn-boundary switches show `→ […]`. |
| **F6** / `:mode` | **Mode panel:** presets `full`, `judge-only`, `narrate-only`, `rule`, plus S2 tier picks. Unavailable entries (no model for that role) are disabled. |
| `:mode` | `:mode status`; `:mode rule`; `:mode s1 llm\|rule`; `:mode s2 llm\|rule\|<tierId>` |

Narration renders indented in `theme.colors.narration`; `scene_break` shows a horizontal rule (`─`) with optional caption. See [spec Section 21.4](./spec.md#214-cue-and-narration-rendering).

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
