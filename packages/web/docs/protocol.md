# Animae Web Protocol (v1)

JSON messages over WebSocket (`/ws`). Every message includes `"v": 1`.

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
| `hello` | `{ role?: "controller" \| "spectator", resumeSeq?, token?, clientId? }` |
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
| `ollama_models` | `{ id, baseURL? }` — list local Ollama models via `/api/tags` (host-defined) |
| `content_pack_notice` | `{ id, packId }` — fetch opt-in pack notice text |
| `ping` | `{ id }` |

## Server → client

| `type` | Purpose |
|--------|---------|
| `hello_ok` | `{ sessionId, role, controllerPresent, protocolVersion, seq }` |
| `snapshot` | Full UI state (see below) |
| `patch` | `{ ops: [{ op, path, value? }] }` — incremental snapshot updates when diff is small |
| `stream` | Token-level narration/dialogue |
| `event` | `{ kind, payload }` — engine timeline events |
| `error` | `{ code, message, id? }` |
| `toast` | `{ level, text }` |
| `busy` | `{ active, requestId?, progress? }` |
| `result` | Request acknowledgement |
| `pong` | Ping reply |
| `heartbeat` | Keep-alive (~30s) |

### `snapshot.state` shape (host-defined superset)

Core keys emitted by `@animae/host` `SessionHost.buildSnapshot()`:

```json
{
  "protocolVersion": 1,
  "scene": { "id", "active", "location", "speaker?", "participants?" },
  "header": { "time": { "day", "minute", "label" }, "location?", "chapter?", "branch?" },
  "footer": { "beat?", "budget?", "hints?" },
  "transcript": [{ "id", "kind", "speaker?", "text", "complete", "turnId?" }],
  "choices": { "choices": [{ "id", "text" }], "selected" },
  "focusTarget": "entity-id?",
  "pending": false,
  "turnError": "string?",
  "actions": [{ "id", "label", "args?", "entityScoped?", "toolbar?" }],
  "panels": { "<panelId>": { ... } },
  "roster": {},
  "jobs": {},
  "resources": {},
  "factions": {},
  "calendar": {},
  "achievements": {},
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

## Roles

- One **controller** per session (plays turns, commands, saves).
- Additional clients join as **spectators** (snapshots + streams + events only).
- Second controller receives `CONTROLLER_TAKEN` and stays read-only.

## TypeScript & Zod

Import from `@animae/web/protocol`:

```typescript
import { ClientMessageSchema, ServerMessageSchema } from "@animae/web/protocol";
```
