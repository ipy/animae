# Animae Web Protocol (v1)

JSON messages over WebSocket (`/ws`). Every message includes `"v": 1` (`WEB_PROTOCOL_VERSION`).

## Correlation

- Client requests that mutate state include `"id"` (string, max 64 chars).
- Server replies with `{ "type": "result", "id", "ok": true, "data"? }` or `{ "type": "error", "id"?, "code", "message" }`.
- Streaming turn output uses `{ "type": "stream", "requestId", "phase", "segment", ... }` tied to the same `id` as `input` / `choose`.

## Sequencing & resume

- Server assigns monotonic `"seq"` on outbound messages (except some heartbeats).
- `hello` may include `resumeSeq`; server replays buffered messages with `seq > resumeSeq` after the initial `snapshot`.

## Client → server

| `type` | Purpose |
|--------|---------|
| `hello` | `{ role?: "controller" \| "spectator", resumeSeq?, token?, clientId?, locale? }` — optional BCP-47 UI locale (e.g. `"en"`, `"zh-CN"`) |
| `set_locale` | `{ id, locale }` — switch this client's UI locale; server responds with `result` + fresh localized `snapshot` |
| `claim_controller` | `{ id, force? }` — take the controller seat |
| `release_control` | `{ id }` — voluntary spectator mode |
| `input` | `{ id, text, choiceId? }` — player turn (controller) |
| `command` | `{ id, name, args?: string[] }` — colon-style command |
| `action` | `{ id, actionId, entityId?, args?: Record<string,string> }` |
| `choose` | `{ id, choiceId }` |
| `select_focus` | `{ id?, entityId? }` |
| `rewind` | `{ id, eventId }` |
| `branch` | `{ id, name }` — switch timeline branch |
| `save` | `{ id, label? }` |
| `load` | `{ id, slot? }` |
| `list_saves` | `{ id }` |
| `get_state` | `{ id }` |
| `query` | `{ id, path, viewer? }` |
| `config_get` | `{ id, keys?: string[] }` — secrets masked |
| `config_set` | `{ id, patch, consent? }` — optional content-pack consent payload |
| `cancel` | `{ id, targetId? }` — abort in-flight turn (client UI + host signal) |
| `models_probe` | `{ id, slot?: "s1" \| "s2" }` — connectivity test (host-defined) |
| `images_probe` | `{ id, draft?: object }` — image generator health check; `draft` carries unsaved settings (host-defined, controller only, `UNSUPPORTED` without a host hook) |
| `ollama_models` | `{ id, baseURL? }` — list local Ollama models via `/api/tags` (host-defined) |
| `content_pack_notice` | `{ id, packId }` — fetch opt-in pack notice text |
| `llm_log` | `{ id, since?, limit?, label?, slot?, errorsOnly? }` — in-memory model call log (when host enabled `modelCallLog` on the engine); `result.data`: `{ enabled, entries, newestSeq }`, at most **50** entries per response |
| `llm_log_clear` | `{ id }` — clear the in-memory log buffer |
| `ping` | `{ id }` |
| `gallery_list` | `{ id, includeLocked?, includeUnavailable?, debug? }` — spectator OK |
| `gallery_get` | `{ id, entryId, includeLocked?, includeUnavailable?, debug? }` |
| `gallery_ratings` | `{ id }` |
| `gallery_jobs` | `{ id }` |
| `gallery_capture` | `{ id, req? }` — controller only |
| `gallery_render` | `{ id, entryId, reroll?, seed? }` — controller only |
| `gallery_cancel` | `{ id, job }` — controller only |
| `gallery_remove` | `{ id, entryId }` — controller only |
| `gallery_pin` | `{ id, entryId, pinned }` — controller only |
| `gallery_unlock` | `{ id, entryId, source? }` — controller only; server must set `gallery.allowGalleryUnlock` |

### Gallery HTTP (same session auth as `/ws`)

`GET|HEAD /api/gallery/image/<entryId>?v=<imageId>` — bytes when unlocked and available; `404` otherwise; `ETag` `"<imageId>"`; `Cache-Control` from host `galleryImagePolicy` (default: `immutable` for default rating, `no-store` for others). No path traversal: ids are validated and resolved through `engine.gallery.image`.

## Server → client

| `type` | Purpose |
|--------|---------|
| `hello_ok` | `{ sessionId, role, controllerPresent, protocolVersion, seq, clientId?, locale, locales }` — `locale` is negotiated tag; `locales` is `{ tag, name }[]` supported list with native names (`Intl.DisplayNames`) |
| `locale` | `{ locale }` — negotiated UI locale for this client (after `hello` or `set_locale`) |
| `snapshot` | Full UI state (see below) |
| `patch` | `{ ops: [{ op, path, value? }] }` — incremental snapshot updates when diff is small |
| `stream` | Per-**utterance** narration/dialogue (`start` / `delta` / `end`); each `delta` is a text **fragment**, not a full line |
| `event` | `{ kind, payload }` — engine timeline events |
| `error` | `{ code, message, id?, params? }` — `message` localized per client; `code`/`params` stable for clients |
| `toast` | `{ level, text }` — `text` localized per client |
| `role` | `{ role, message? }` — optional localized `message` (e.g. controller lost) |
| `busy` | `{ active, requestId?, progress? }` |
| `result` | Request acknowledgement |
| `pong` | Ping reply |
| `heartbeat` | Keep-alive (~30s) |
| `gallery_notice` | `{ notice: GalleryNotice }` — pushed to every connected client on unlock/job/changed |

### `snapshot.state` shape (host-defined superset)

Core keys emitted by `@animae/host` `SessionHost.buildSnapshot()`:

```json
{
  "protocolVersion": 1,
  "scene": { "id", "active", "location", "speaker?", "participants?" },
  "header": { "time": { "day", "minute", "label" }, "location?", "chapter?", "branch?" },
  "footer": { "beat?", "budget?", "hints?" },
  "transcript": [{ "id", "kind", "speaker?", "text", "i18n?", "complete", "turnId?" }],
  "choices": { "choices": [{ "id", "text" }], "selected" },
  "focusTarget": "entity-id?",
  "pending": false,
  "turnError": "string?",
  "actions": [{ "id", "label", "i18n?", "args?", "entityScoped?", "toolbar?" }],
  "panels": { "<panelId>": { ... } },
  "roster": [{ "id", "name?", "lod?" }],
  "mods": {},
  "branch": {}
}
```

### `stream`

```json
{
  "type": "stream",
  "seq": 12,
  "requestId": "r7",
  "phase": "start" | "delta" | "end",
  "segment": "narration" | "dialogue" | "thought" | "system" | "event",
  "speaker": "optional",
  "text": "delta text when phase=delta",
  "turnId": "when phase=end"
}
```

### `event`

```json
{
  "type": "event",
  "seq": 20,
  "kind": "game.achievement.unlocked",
  "payload": { "...": "EngineEvent envelope" }
}
```

## Locale (additive, v1-compatible)

1. Client sends `hello` with optional `locale` (BCP-47).
2. Server negotiates against supported tags (`en`, `zh-CN`, …), stores locale per WebSocket client, and includes negotiated `locale` plus `locales: [{ tag, name }]` on `hello_ok`.
3. Initial `snapshot` (and subsequent `patch` / per-client `get_state`) is localized for that client: header/footer labels, system transcript lines, action labels, panel display strings, `turnError`, etc.
4. Client may send `set_locale { id, locale }` → `{ type: "locale", locale }`, `{ type: "result", id, ok: true, data: { locale } }`, plus a full localized `snapshot` for that client only.
5. Machine fields stay neutral (`id`, `code`, `params`, entity ids, event kinds). Human-readable server fields (`error.message`, `toast.text`, snapshot display copy) are localized per client; broadcast paths (events, toasts) send **different JSON per client** when locales differ.
6. When game/host state carries deferred copy, wire payloads include both resolved `text`/`label` and optional `i18n: { key, params? }` so the frontend can re-localize history after `set_locale` without rewriting the timeline. Server helper: `localizeSnapshot(state, t)` from `@animae/host`.

Example messages:

```json
{ "v": 1, "type": "hello", "role": "controller", "clientId": "tab-abc12345", "locale": "zh-CN" }
```

```json
{
  "v": 1,
  "type": "hello_ok",
  "seq": 1,
  "sessionId": "…",
  "role": "controller",
  "controllerPresent": true,
  "protocolVersion": 1,
  "locale": "zh-CN",
  "locales": [{ "tag": "en", "name": "英语" }, { "tag": "zh-CN", "name": "中文（简体）" }]
}
```

```json
{ "v": 1, "type": "set_locale", "id": "loc1", "locale": "en" }
```

```json
{ "v": 1, "type": "error", "code": "NO_SCENE", "message": "No active scene", "params": {} }
```

## Roles

- One **controller** per session (plays turns, commands, saves).
- Additional clients join as **spectators** (snapshots + streams + events only).
- Second controller receives `CONTROLLER_TAKEN` and stays read-only.

## TypeScript & Zod

Import from `@animae/web/protocol`:

```typescript
import { ClientMessageSchema, ServerMessageSchema } from "@animae/web/protocol";
```
