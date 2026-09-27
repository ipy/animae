# `@animae/web`

## Purpose

Browser transport for Animae hosts: static asset serving (embeddable), WebSocket protocol v1, session roles (controller vs spectator), and security defaults for local/LAN play.

## Public API

- `createWebServer(opts)` — `Bun.serve` with `/`, `/ws`, `/api/health`, `/api/version`.
- `createDirectoryAssetProvider(root)` / `createMemoryAssetProvider(files)` — static assets for dev vs compiled embed.
- `@animae/web/protocol` — Zod schemas + TS types for client/server messages (snapshot `scene.participants` for stage composition).

Companion package **`@animae/host`** holds UI-agnostic `SessionHost` (commands, actions, panels, turn streaming) shared with `@animae/tui` extension surfaces.

## Security

- Default bind `127.0.0.1` (no token).
- `--host 0.0.0.0` (or any non-loopback) requires a random auth token (query param, `X-Animae-Token`, or cookie).
- Origin allow-list, CSP on static responses, max WS payload size, per-connection rate limit.

## Tests

`bun test` in `packages/web` — protocol round-trips, asset provider, WS integration with `ScriptedModel`.

## Decisions

- Snapshots are full-state for v1; `patch` message type is defined for future incremental updates.
- Engine events broadcast on `event` messages (`engine.on("*")`).
- Config secret masking is the host application's responsibility via `WebSessionHooks.configGet`.
- Error frames carry `{ code, message, localized? }`. `localized: true` means `message` was rendered from a catalog in the client's locale and can be shown as-is; otherwise `message` is a developer diagnostic and the client should show its own copy for `code` (falling back to a generic "something went wrong (code)" text, never a raw message key).
- Frame timing contract for clients: frames from one client run in order, so the server reports `busy` only after it has dequeued a turn-starting frame (`input`, `choose`, `command`) and answers with `result` / `error` when it finishes. Snapshot pushes are single-flight, so `transcript` patches can trail `busy: false` by a few hundred milliseconds. A client should lock its turn controls from the moment it sends such a frame until the answer arrives (otherwise a second click queues a second turn) and treat the transcript as eventually consistent.
- Stream replay on `hello`: the room buffers the last 500 `stream` / `busy` messages. A returning client (`resumeSeq > 0`) receives everything after the last message it saw. A client that has seen nothing (`resumeSeq` 0 or absent: a fresh page or tab) already holds the whole state from the snapshot, so earlier turns are not replayed; it only receives the turn that is still running (from its first `busy` report), so a client that joins mid-turn follows the stream from the start. Replaying finished turns to a fresh page used to apply hundreds of stale messages back to back, and the resulting burst of state updates could trip a UI framework's update-loop guard.
- Per-client UI locale: `hello.locale`, `hello_ok.locale`, `set_locale`, and `locale` ack messages; localized snapshots/errors/toasts via `runWithLocale` pattern inside `SessionRoom` (`broadcastLocalized`).

## Changelog

- **2026-10-30:** Per-client locale negotiation; `locale` server message; ref-client locale selector.
