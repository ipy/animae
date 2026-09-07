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
- Config secret masking is the host game's responsibility via `WebSessionHooks.configGet`.
