# @animae/tui

## Unreleased

- `ResolvableText` / `resolveText` moved to `@animae/i18n` (headless hosts need them too); `@animae/tui` re-exports both, so existing imports keep working.
- Input: `createPreparsedStdin` single consumer + 50ms Esc; ref-first draft (never shrink ref when state lags), Ctrl-only letter shortcuts, F-keys no longer leak into input line, bracketed paste hook, Alt+1–5 overlay aliases.
- PTY: `pty_lib.py` (reader thread + pyte), `pty-input-harness.py`, `pty_tui_rigor.py` against compiled host binaries; optional CI gate from host package build.
- `test/key-sequences.test.ts`.
- Terminal mouse reporting (xterm SGR 1006): parse before Ink key input, cleanup on exit/signals.
- `Clickable`, `Button`, `ActionToolbar`, `CommandPalette`, entity action menu, inline `PromptDialog`.
- `RunTuiOptions.actions`, `entityActions`, `mouse`, `nameHints`; `CommandApi.setMouseCapture`.
- Transcript wheel scroll + jump-to-latest; clickable choice rows; collapsible side panel sections.
- Keys: Ctrl+P palette, Ctrl+M mouse toggle, Tab autocomplete for `:` commands.
