# Changelog

## Unreleased

- **`consumeTurnStream`:** `narration` paragraphs (with `style`), **`reset`** discards in-flight transcript/stream since the actor echo; Web `stream.phase: reset`.
- `HostAction` / `HostEntityAction` labels, hints, and arg field labels accept `ResolvableText` (`string | () => string`, now defined in `@animae/i18n` and re-exported by `@animae/tui`, so the host no longer depends on the terminal UI at run time); `SessionHost.listActions()` resolves them for the viewer locale.
- Optional `HostCommandApi.focusTarget()` for command inference in remote UIs.

## 1.0.0 — 2026-10-30

- Initial `@animae/host`: `SessionHost`, shared command/action/panel surfaces, turn stream consumer for Web (TUI can adopt later).
