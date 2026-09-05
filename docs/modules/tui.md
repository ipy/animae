# `@animae/tui`

## Purpose

Terminal game shell built on **Ink 8** and **React 19**. All panel data is read via `engine.query(viewer, path)` (default viewer `player`).

## Public API

- `runTui(opts: RunTuiOptions): Promise<void>` — alternate screen, restores terminal on exit; closes engine. Uses Ink `incrementalRendering: true` and `maxFps: 30` to limit full redraw flicker.
- `defaultLayout` — §21.2 layout (Header, Transcript 70% / SidePanel 30%, ChoiceMenu, InputLine, Footer).
- `components` — Header, Footer, Transcript, Typewriter, ChoiceMenu, InputLine, SidePanel, TrackBar, FieldList, EventLog, TimelineBrowser, ExplainView, Inspector, Overlay.
- `hooks` — useEngine, useTurn, useQuery, useEvents, useTheme, useKeymap (`bind` for overrides).

## Spec-compat extensions

`RunTuiOptions` also accepts:

| Option | Purpose |
|--------|---------|
| `commands` | Extra `:` commands; string result → system transcript line |
| `panels` | Extra SidePanel sections (`render({ viewer, engine })`) |
| `header` / `footer` | Replace default chrome slots in `defaultLayout` |
| `onSceneEnd` | Called after `engine.scene.end` |
| `initialMessage` | System line in transcript at start |
| `onReady` | Dev harness hook (automation); not for production games |

Works with **no scene** (hint + `:` commands). With `scene`, starts automatically; transcript persists after `endScene`.

## Keys (§21.3)

Enter, ↑/↓, 1–9, skip typewriter (any key), Tab focus (+ SidePanel overlay when &lt;100 cols), PgUp/PgDn scroll, F1–F5 overlays, Ctrl+S/L/Z, Esc, Ctrl+C quit.

**Choice digits vs input:** `1`–`9` pick choices only when the input draft is **empty** and focus is **not** on the input line. With focus on input (including while choices are visible), digits are inserted as text.

## Cues (§21.4)

`CueRenderer` registry; built-ins `expression`, `action`, `sfx` (optional terminal bell via `theme.bell`). Unregistered cue types hidden in transcript (still in EventLog via engine events).

## Theme (§21.5)

YAML or object; Zod-validated (`theme/load.ts`). Defaults in `theme/defaults.ts`.

## Visual / UX (QA pass)

| Area | Behaviour |
|------|-----------|
| Header | Compact `Day N HH:MM · location · chapter · branch` |
| Speakers | `characters/*/identity.color` when query allows; else theme `npc` / `player` |
| SidePanel tracks | `ParticipantTracks`: player-visible **tier labels** (zh-CN map when chapter title is Chinese); raw track values hidden per example-game visibility |
| Transcript | CJK wrap via display width; typewriter wraps live; scroll window scales with terminal height; store capped at 400 entries |
| InputLine | Grapheme cursor with inverse cell; horizontal scroll for long CJK/ASCII lines |
| Errors | Turn failures show warning banner; transcript system line; UI stays usable |
| Ink | `incrementalRendering` + `maxFps` on `runTui` |

## Dev & QA harness

| Script | Purpose |
|--------|---------|
| `scripts/dev-session.ts` | Real example-game `data/` copy, `openexample-gameEngine`, `ScriptedModel`, `BasePanel` panel, `registerexample-gameRules` via bootstrap |
| `scripts/qa-scenario-keys.json` | Shared keystroke schedules (kept in sync with batch scenarios) |
| `scripts/pty-render.py` | Python `pty` driver; waits for `TUI_READY` on stderr, injects keys on the PTY master; sizes 120×40, 100×30, 90×30, 79×23, 160×50; writes grids to `animae/docs/tui-snapshots/` |
| `scripts/demo.ts` | Fake engine interactive demo |

Batch mode writes `TUI_READY` once the shell is mounted and any initial `scene.start` has finished (`onReady`). Set `TUI_PTY_DRIVER=1` when an external driver owns keystrokes (pty-render).

```bash
cd animae/packages/tui
bun run scripts/dev-session.ts              # interactive (PTY recommended)
python3 scripts/pty-render.py               # regenerate snapshot grids
TUI_SNAPSHOT_SCENARIOS=empty,cjk python3 scripts/pty-render.py
```

## Tests

`bun test` in package; component/frame checks use `test/helpers/ink-harness.ts` (`stripAnsi`, `incrementalRendering`).

## Decisions & gaps

- **F-keys / PTY**: `useParsedInput` + vendored `parseKeypress` and Ink’s `input-parser` (split bulk stdin like PTY `:help` + Enter); maps `enter` and `return`; `TuiApp` mirrors input draft in refs so batched keys commit correctly. No `createRequire` / `ink/build/…` at runtime. Quit calls `app.exit()` before `engine.close()` so unreachable LLM calls cannot block exit. Typewriter skips do not block the input line when focus is `input`.
- **Inspector**: read-only tree for common paths; arbitrary paths via `:query`.
- **Policy track metadata**: tier **names** come from engine query; zh labels use example-game tier map until `policy/tracks` is exposed on `query`.
- **Budget footer**: tries `query(viewer,"budget")` then `director/beat/budget`.

## Integrator notes

- Code against `Engine` / `TurnChunk` from `@animae/engine`; use `createEngine` when available.
- Pass custom `cueRenderers`, `keymap`, `layout` for full replacement.
- `CommandApi` exposes `engine`, `viewer`, `actor`, scene helpers, overlays, `notify`.

## QA before / after (summary)

| Scenario | Before | After |
|----------|--------|--------|
| SidePanel tracks | Placeholder mood bar + numeric value | Participant tier labels (no hidden track numbers) |
| Long sessions | Transcript array unbounded; fixed 12-entry viewport | 400-entry cap; viewport scales with rows |
| CJK typewriter | Single-line reveal; borders could mis-wrap | Wrapped lines during typewriter |
| InputLine | Truncated text, cursor at end only | Grapheme-aware cursor + scroll window |
| Choice `1`–`9` | Always stole digits when choices open | Respects non-empty input / input focus |
| Rendering | Full redraw default | Incremental + 30 fps cap |
| Speaker colors | player/npc only | Card `color` via `characters/*/identity` |
| Header | Mixed time formats | `Day N HH:MM` compact line |

Snapshot grids under `animae/docs/tui-snapshots/*.txt` for empty, scene-start, typewriter, cjk, choices, help, narrow at listed sizes.
