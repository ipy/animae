# Changelog

## 1.0.0 — 2026-10-30

- Initial `@animae/web`: protocol v1 (Zod + docs), Bun server, asset providers, WS session room, integration tests.

## 1.0.1 — 2026-10-30

- Incremental `patch` snapshots via shallow diff in `SessionRoom`.
- Client messages: `models_probe`, `content_pack_notice`.
- `/ref` diagnostic static route; SPA path normalisation for ref client.
- Turn cancel wired through host `AbortSignal` (consumer stops streaming; engine may still finish in background).

## 1.0.2 — 2026-10-30

- Document `patch`, `cancel`, `models_probe`, and `content_pack_notice` in protocol.md (aligned with session room).
- `@animae/engine` `world/locations/{id}` query now includes authored `summary` and `connects` for map UIs (additive).
