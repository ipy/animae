# `@animae/tui`

## Purpose

Terminal game shell built on **Ink 8** and **React 19**. Panel data uses the `useQuery` hook, which reads via `engine.queryAsync` for the `player` viewer (lazy catch-up, spec 12.6) and synchronous `engine.query` for other viewers.

## Public API

- `runTui(opts: RunTuiOptions): Promise<void>` — alternate screen, restores terminal on exit; closes engine. Uses Ink `incrementalRendering: true` and `maxFps: 30` to limit full redraw flicker.
- `defaultLayout` — [default layout (Section 21.2)](../spec.md#212-default-layout) (Header, Transcript 70% / SidePanel 30%, ChoiceMenu, InputLine, Footer).
- `components` — Header, Footer, Transcript, Typewriter, ChoiceMenu, InputLine, SidePanel, TrackBar, FieldList, EventLog, TimelineBrowser, ExplainView, Inspector, **ModePanel**, Overlay.
- `hooks` — useEngine, useTurn, useQuery, useEvents, useTheme, useKeymap (`bind` for overrides), **useRuntimeMode**.

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
| `displayName` | `(id) => string \| undefined` — display name for character ids in transcript speaker labels and the participant panel. Needed when the viewer cannot read card identities through `engine.query` (the usual case for `player`); without it labels fall back to the identity query, then the raw id. |
| `onSceneEnd` | Called after `engine.scene.end` |
| `initialMessage` | System line in transcript at start |
| `onReady` | Dev harness hook (automation); not for production games |
| `uiLocale` | BCP-47 tag for built-in chrome (`ANIMAE_LOCALE` in harnesses). `:lang` switches locale at runtime. |

### Localizable host-provided copy

Toolbar actions, entity actions, custom command descriptions, side-panel section titles, and prompt titles accept `string | (() => string)` (`ResolvableText`). Components call `resolveText()` at render time and subscribe to `TuiI18nProvider` so `:lang` updates chrome without restart.

Works with **no scene** (hint + `:` commands). With `scene`, starts automatically; transcript persists after `endScene`.

## Mouse (xterm SGR)

When stdin/stdout are a TTY, the shell enables `?1000/1002/1006` (+ optional `?1003` hover). SGR sequences are stripped **before** Ink’s key parser so clicks never leak into the input line. **Shift+drag** is left to the terminal for native text selection. Toggle: `:mouse on|off`, **Ctrl+M**, or `NO_MOUSE=1`.

Hooks/components: `MouseProvider`, `useMouseTarget`, `Clickable`, `Button`, `useElementRect` (via `measureElement`).

## Actions API

Register **`TuiAction`** items on `RunTuiOptions.actions` and **`EntityTuiAction`** on `entityActions`. Each action has `id`, `label`, optional `hint`, `hotkey`, `when(ctx)`, optional `args` (inline prompt: text or select), and `run`. They feed the **action toolbar**, **entity context menu** (when `focusTarget` is set), and **command palette** alongside `commands`.

Host applications dispatch `setFocusTarget` / `setEntityMenu` via `useAppState()` (exported from `@animae/tui` hooks).

## Input pipeline

Real TTY stdin is consumed once in `createPreparsedStdin` (50ms Esc window, UTF-8 reassembly, SGR mouse stripped to `preparsedMouseBus`); Ink reads a synthetic TTY `PassThrough` so Ink’s 20ms flush never splits SS3/CSI. On stdin `end`/`close`/`error`, SIGHUP/SIGTERM, or stdout/stderr `EPIPE`/`EIO`, `installTerminalShutdown` unmounts Ink and `runTui` stops waiting on `waitUntilExit` (hard `process.exit` after 2s if needed) so closing the terminal never leaves a render loop spinning. `useParsedInput` listens to Ink’s emitter only (no second OS reader), maps via vendored `parseKeypress`, and must **not** flush pending Esc on the next chunk. Input draft: ref-first, microtask-coalesced dispatch; React state must never overwrite a longer ref (fixes mixed bursts of narrow and wide characters). Ctrl-letter shortcuts match **only with Ctrl**; **Alt+1–5** mirror F1–F5.

PTY rigor (compiled host binary, vendored **pyte** under `scripts/vendor/`): `python3 scripts/pty_tui_rigor.py --quick` — typical quick gate: stress drops **0**, mixed 80-char narrow+wide text **ok**, Esc close ≈ **0.1–0.15 s** (the 50 ms escape-sequence window plus one 30 fps frame; the gate warns above 200 ms), stress p95 **&lt;80ms** (120×40). The harness decodes the PTY byte stream with an incremental UTF-8 decoder, so a multi-byte character split across two reads never turns into U+FFFD on the emulated screen.

## Layout contract (Ink 8 / Yoga)

The frame is exactly as tall as the terminal (`height={rows}`). The chrome — header, toolbar, hint, choice menu, input line, footer — has `flexShrink={0}` and keeps its natural height; the main region (transcript + side panel, or a modal) is `flexGrow={1} flexShrink={1} flexBasis={0} overflow="hidden"` and is the only thing that gives way.

- **Never rely on Yoga shrinking text.** Ink paints a `Text` child's *full* content even when Yoga has squeezed its box below the content height, so siblings overlap. Every child of a fixed-height container must therefore have `flexShrink={0}` and the container `overflow="hidden"`. `components/Viewport.tsx` packages this: `Stack` wraps each child in a non-shrinking column, `Viewport` is a clipping region (`anchor="end"` pins the newest rows to the bottom, which is what the transcript wants; `"start"` for lists). Use them for any region whose content can exceed its height; `test/layout-overflow.test.tsx` has a control showing the overlap without `flexShrink={0}`.
- **Modals replace the main region.** Ink has no transparent layer, so `Overlay` content is handed to the layout through `OverlaySlotProvider` / `useOverlaySlot()` and `defaultLayout` renders it *in place of* transcript and side panel. Header, toolbar and input line stay where they were and a modal can never push the input off screen. A custom `layout` that does not read the slot keeps the previous behaviour (overlays drawn below the layout).
- **Side panel** scrolls by metrics (`useBoxMetrics` on viewport and content): hidden rows above/below are reported by the `▲ n · ▼ m` indicator, the wheel (`wheel: true` mouse target), PgUp/PgDn and `scrollSide` all move it, and the offset is clamped to the laid-out height. Generic sections (participants, tracks, fields, anchor) only take room while they have data.
- **Transcript** keeps one entry per line for system output (`appStateReducer` splits multi-line system text, ids stay unique across the 400-entry trim), so the visible window never cuts an entry in half; `transcriptEntryWindow` / `transcriptPageStep` derive window and page size from the row count.
- **Mouse wheel** goes to the topmost target registered with `wheel: true`; plain click targets never swallow wheel events.

When touching layout code, check the result with an emulator that is not the harness's own (for example `@xterm/headless` fed with the raw PTY bytes) as well as with pyte: the raw byte stream can contain the right text while the composed screen shows overlapping or clipped rows.

## Keys ([Section 21.3](../spec.md#213-overlays-and-keys))

Enter, ↑/↓, 1–9, skip typewriter (any key), Tab focus (+ autocomplete), **Ctrl+P** or **`/`** (empty input) command palette, Tab focus (+ SidePanel overlay when &lt;100 cols), PgUp/PgDn scroll, wheel on transcript, **F1–F6** overlays (**Alt+1–6** same, for macOS F-keys as media keys; **F6** = runtime mode panel), Ctrl+S/L/Z/M, Esc, Ctrl+C quit.

**Choice digits vs input:** `1`–`9` pick choices only when the input draft is **empty** and focus is **not** on the input line. With focus on input (including while choices are visible), digits are inserted as text.

## Cues and narration ([Section 21.4](../spec.md#214-cue-and-narration-rendering))

`CueRenderer` registry; built-ins `expression`, `action`, `sfx` (optional terminal bell via `theme.bell`). Unregistered cue types hidden in transcript (still in EventLog via engine events).

**Narration** (`TurnChunk` `narration`): indented lines in `theme.colors.narration`; `scene_break` renders as a horizontal rule. **`reset`** removes in-flight transcript rows (player echo kept) before replacement streams. Footer shows runtime mode (`modeIndicator`); mode changes and fallbacks may add system lines.

## Theme ([Section 21.5](../spec.md#215-theme))

YAML or object; Zod-validated (`theme/load.ts`). Defaults in `theme/defaults.ts`.

## Visual / UX (QA pass)

| Area | Behaviour |
|------|-----------|
| Header | Compact `Day N HH:MM · location · chapter · branch` |
| Speakers | `characters/*/identity.color` when query allows; else theme `npc` / `player` |
| SidePanel tracks | `ParticipantTracks`: tier/track labels from `locales/*/tui.json` (`tiers.*`, `tracks.*`) using active UI locale (`useTuiI18n().locale`) — no chapter-language heuristics |
| Transcript | Wide-character wrap via display width; typewriter wraps live; tail-anchored `Viewport` (newest line sits on the input line, older rows clip at the top); scroll window scales with terminal height; store capped at 400 entries |
| InputLine | Grapheme cursor with inverse cell; horizontal scroll for long lines of narrow and wide characters |
| Errors | Turn failures show warning banner; transcript system line; UI stays usable |
| Ink | `incrementalRendering` + `maxFps` on `runTui` |

## Dev & QA harness

| Script | Purpose |
|--------|---------|
| `scripts/dev-session.ts` | Temp data root via `copyDemoDataRoot()` (`seedE2eAuthored`), `createEngine` + `e2ePreset`, `ScriptedModel`, custom `DemoSidePanel`, optional QA actions |
| `scripts/qa-scenario-keys.json` | Shared keystroke schedules (kept in sync with batch scenarios) |
| `scripts/pty-render.py` | Python `pty` driver; waits for `TUI_READY` on stderr, injects keys on the PTY master; sizes 120×40, 100×30, 90×30, 79×23, 160×50; writes grids to `docs/tui-snapshots/` |
| `scripts/pty-input-harness.py` | PTY regression: burst/paced typing (narrow and wide characters), F-keys/Esc (full mode), `TUI_PTY_DRIVER=1`; `bun run test:pty` (quick), `test:pty:full` |
| `scripts/pty_locale_harness.py` | Locale gate: alternate UI locale boot + `:lang` flip |
| `scripts/pty_tui_rigor.py` | Compiled host TUI binary: pyte screen, stress typing, F1/Esc/palette; `--quick` for CI/build gates |
| `scripts/pty_lib.py` | Shared PTY reader thread + optional vendored pyte (`scripts/vendor/`) |
| `scripts/demo.ts` | Fake engine interactive demo |

Batch mode writes `TUI_READY` once the shell is mounted and any initial `scene.start` has finished (`onReady`). Set `TUI_PTY_DRIVER=1` when an external driver owns keystrokes (pty-render).

```bash
cd packages/tui
bun run scripts/dev-session.ts              # interactive (PTY recommended)
python3 scripts/pty-render.py               # regenerate snapshot grids
TUI_SNAPSHOT_SCENARIOS=empty,wide python3 scripts/pty-render.py
```

## Tests

`bun test` in package; component/frame checks use `test/helpers/ink-harness.ts` (`stripAnsi`, `incrementalRendering`). `test/layout-overflow.test.tsx` renders the whole `TuiApp` at 120×40 with a 90-line transcript, a 60-row side panel and a modal, and asserts row positions (tail directly above the input, panel rows consecutive, nothing below the input row); `test/transcript-reducer.test.ts` covers system-line splitting, id uniqueness and scroll clamping. Strict hygiene: `test/hygiene/no-hardcoded-ui-text.test.ts` fails on English UI literals in `src/**` — JSX text, `{"..."}` expression literals, `title`/`hint`/`label`/… props, `notify(...)` and system lines, including ones that start with `(` or `[`. Allowlisted are key chords, engine path labels and internal ids; a bare key name (`Esc`, `Enter`, `Tab`, `PgUp`, `F1`…) is a label, but a sentence that merely mentions one is player copy and must go through `t()`.

## Decisions & gaps

- **F-keys / PTY**: SS3 `\x1bOP`…`\x1bOS`, CSI `\x1b[11~`…, pending-Esc timeout 50ms; table tests in `test/key-sequences.test.ts`. `matchKeyAction` requires Ctrl for Ctrl-letter bindings so words like `achievements` type correctly. Bracketed paste enabled when `onPaste` is set on `useParsedInput`.
- **Inspector**: read-only tree for common paths; arbitrary paths via `:query`.
- **Policy track metadata**: tier **names** come from engine query; localized labels use `locales/*/tui.json` (`tracks.*`, `tiers.*`) until `policy/tracks` is exposed on `query`.
- **Budget footer**: `query(viewer,"budget")` (nothing when the viewer may not read it).

## Integrator notes

- Code against `Engine` / `TurnChunk` from `@animae/engine`; use `createEngine` when available.
- Pass custom `cueRenderers`, `keymap`, `layout` for full replacement.
- `CommandApi` exposes `engine`, `viewer`, `actor`, scene helpers, overlays, `notify`.

## QA before / after (summary)

| Scenario | Before | After |
|----------|--------|--------|
| SidePanel tracks | Placeholder mood bar + numeric value | Participant tier labels (no hidden track numbers) |
| Long sessions | Transcript array unbounded; fixed 12-entry viewport | 400-entry cap; viewport scales with rows |
| Wide-character typewriter | Single-line reveal; borders could mis-wrap | Wrapped lines during typewriter |
| InputLine | Truncated text, cursor at end only | Grapheme-aware cursor + scroll window |
| Choice `1`–`9` | Always stole digits when choices open | Respects non-empty input / input focus |
| Rendering | Full redraw default | Incremental + 30 fps cap |
| Speaker colors | player/npc only | Card `color` via `characters/*/identity` |
| Header | Mixed time formats | `Day N HH:MM` compact line |

Snapshot grids under `docs/tui-snapshots/*.txt` for empty, scene-start, typewriter, wide, choices, help, narrow at listed sizes.
