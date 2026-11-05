# Changelog

## Unreleased

- WebSocket **`stream`**: `segment: narration` with `style` on `start`; **`phase: reset`** when the engine replaces in-flight turn output (rule fallback). Schema in `protocol/schemas.ts`; `SessionRoom` maps `@animae/host` stream callbacks.

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

## 1.0.3 — 2026-11-01

- Optional `WebSessionHooks.environment` and authenticated `GET /api/environment` for host path metadata on the diagnostics Overview tab.
- Rebuilt `ref-client/` as a styled diagnostics console: tabs for smoke tests, model call log (`llm_log` / `llm_log_clear`), snapshot/state, live protocol feed, and controller-only console.
- Read-only smoke test runner (injectable transport, unit-tested) covering socket, hello, snapshot shape, ping RTT, locale, config secret masking, llm_log, get_state, and resume quiet check.
- i18n locale catalogs for diagnostics UI strings; light/dark theme toggle with `prefers-color-scheme` support.
- Diagnostics client escapes every dynamic value it writes into HTML (smoke ids, protocol types, model slot/label/id, state cards); `docs/protocol.md` documents the `GET /api/environment` payload as `{ entries: [{ id, label, value, kind? }] }` (it previously said `rows`).
