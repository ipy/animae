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
| `actions` | Toolbar / command-palette / prompt actions (`TuiAction`) |
| `entityActions` | Context actions for `focusTarget` entity ids (roster rows) |
| `panels` | Extra SidePanel sections (`render({ viewer, engine })`) |
| `header` / `footer` | Replace default chrome slots in `defaultLayout` |
| `mouse` | `true` / `false` / `auto` (default); `NO_MOUSE=1` disables |
| `nameHints` | Strings for Tab autocomplete (member names, nicknames) |
| `onSceneEnd` | Called after `engine.scene.end` |
| `initialMessage` | System line in transcript at start |
| `onReady` | Dev harness hook (automation); not for production games |

Works with **no scene** (hint + `:` commands). With `scene`, starts automatically; transcript persists after `endScene`.

## Mouse (xterm SGR)

When stdin/stdout are a TTY, the shell enables `?1000/1002/1006` (+ optional `?1003` hover). SGR sequences are stripped **before** Ink’s key parser so clicks never leak into the input line. **Shift+drag** is left to the terminal for native text selection. Toggle: `:mouse on|off`, **Ctrl+M**, or `NO_MOUSE=1`.

Hooks/components: `MouseProvider`, `useMouseTarget`, `Clickable`, `Button`, `useElementRect` (via `measureElement`).

## Actions API

Register **`TuiAction`** items on `RunTuiOptions.actions` and **`EntityTuiAction`** on `entityActions`. Each action has `id`, `label`, optional `hint`, `hotkey`, `when(ctx)`, optional `args` (inline prompt: text or select), and `run`. They feed the **action toolbar**, **entity context menu** (when `focusTarget` is set), and **command palette** alongside `commands`.

Host games dispatch `setFocusTarget` / `setEntityMenu` via `useAppState()` (exported from `@animae/tui` hooks).

## Input pipeline

Real TTY stdin is consumed once in `createPreparsedStdin` (50ms Esc window, UTF-8 reassembly, SGR mouse stripped to `preparsedMouseBus`); Ink reads a synthetic TTY `PassThrough` so Ink’s 20ms flush never splits SS3/CSI. `useParsedInput` listens to Ink’s emitter only (no second OS reader), maps via vendored `parseKeypress`, and must **not** flush pending Esc on the next chunk. Input draft: ref-first, microtask-coalesced dispatch; React state must never overwrite a longer ref (fixes ASCII+CJK mixed bursts). Ctrl-letter shortcuts match **only with Ctrl**; **Alt+1–5** mirror F1–F5.

PTY rigor (compiled host binary, vendored **pyte** under `scripts/vendor/`): `python3 scripts/pty_tui_rigor.py --quick` — typical quick gate: stress drops **0**, mixed 80-char ASCII+CJK **ok**, Esc close **&lt;1ms** p50, stress p95 **&lt;80ms** (120×40).

## Keys (§21.3)

Enter, ↑/↓, 1–9, skip typewriter (any key), Tab focus (+ autocomplete), **Ctrl+P** or **`/`** (empty input) command palette, Tab focus (+ SidePanel overlay when &lt;100 cols), PgUp/PgDn scroll, wheel on transcript, **F1–F5** overlays (**Alt+1–5** same, for macOS F-keys as media keys), Ctrl+S/L/Z/M, Esc, Ctrl+C quit.

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
| `scripts/pty-input-harness.py` | PTY regression: burst/paced typing (ASCII+CJK), F-keys/Esc (full mode), `TUI_PTY_DRIVER=1`; `bun run test:pty` (quick), `test:pty:full` |
| `scripts/pty_tui_rigor.py` | Compiled host TUI binary: pyte screen, stress typing, F1/Esc/palette; `--quick` for CI/build gates |
| `scripts/pty_lib.py` | Shared PTY reader thread + optional vendored pyte (`scripts/vendor/`) |
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

- **F-keys / PTY**: SS3 `\x1bOP`…`\x1bOS`, CSI `\x1b[11~`…, pending-Esc timeout 50ms; table tests in `test/key-sequences.test.ts`. `matchKeyAction` requires Ctrl for Ctrl-letter bindings so words like `achievements` type correctly. Bracketed paste enabled when `onPaste` is set on `useParsedInput`.
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
