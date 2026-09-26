# JSON-RPC reference

Transport: **one JSON object per line** on stdin/stdout (`animae serve --stdio`). Protocol: JSON-RPC 2.0.

Implementation: `packages/engine/src/rpc/`.

## Error codes

| Code | Name | When |
|------|------|------|
| -32700 | Parse error | Invalid JSON |
| -32600 | Invalid Request | Missing id, bad shape, client notifications |
| -32601 | Method not found | Unknown method |
| -32602 | Invalid params | `RpcParamError` |
| -32603 | Internal error | `AnimaeError` → `{ code, details }` in `error.data` |

## Notifications (server → client)

| Method | Params |
|--------|--------|
| `turn.chunk` | `{ requestId, chunk: TurnChunk }` — during `scene.turn` / `timeline.replay` (see utterance rules below) |
| `event` | `{ kind, event }` — after `subscribe` |
| `gallery.notice` | `GalleryNotice` — unlock / job progress / item changed ([gallery.md](./gallery.md)) |

Client notifications are rejected (except ignored `ping`).

## Methods

Params are objects unless noted. `scene.turn` and `timeline.replay` return `{ events, chunks, summary? }` after stream completes.

### `TurnChunk` (streaming)

Principal shape (see [spec.md](./spec.md)):

```typescript
type TurnChunk =
  | { type: "text"; text: string; speaker?: string; autonomous?: boolean; newUtterance?: boolean }
  | { type: "cue"; cue: Cue; at?: number; speaker?: string }
  | { type: "choices"; choices: Choice[] }
  | { type: "done"; turnId: string; speaker?: string };
```

Consecutive same-speaker `text` chunks between two `done` values are **utterance fragments** unless `newUtterance` is set. Integrators should use `@animae/engine` `applyTextTurnChunk` or `@animae/host` `consumeTurnStream` rather than treating every chunk as a separate line.

### Engine / world

| Method | Params | Result |
|--------|--------|--------|
| `info` | — | `{ preset?, language, locale, promptLocale, outputLocale, contentLocale, branch, sessionId, models, modelMode }` |
| `reload` | — | `{ ok, errors[], warnings[] }` |
| `world.now` | — | `WorldTime` |
| `world.advance` | `{ by: Duration \| { to } }` | `EngineEvent[]` |
| `world.set` | `{ path, value }` | event |
| `world.move` | `{ who, location }` | event |

### Scene

| Method | Params |
|--------|--------|
| `scene.start` | `{ location, participants[], fields? }` → `SceneId` |
| `scene.end` | `{ sceneId }` → `SceneReport` |
| `scene.active` | `{}` → `{ id, location, participants[], turn }` of the open scene, or `null` (re-sync after `timeline.load` / `rewind` / `switch`) |
| `scene.turn` | `{ sceneId, actor, text, addressee?, choiceId? }` → stream + summary |

`scene.turn` is serialized (mutex); concurrent turns queue.

### Timeline

| Method | Params |
|--------|--------|
| `timeline.current` | — |
| `timeline.save` | `{ label? }` |
| `timeline.load` | `{ slot }` |
| `timeline.rewind` | `{ to: eventId }` |
| `timeline.branches` | — |
| `timeline.switch` | `{ b }` |
| `timeline.diff` | `{ a, b }` |
| `timeline.prune` | `{ b }` |
| `timeline.export` | `{ b, o?: { recordings?, file? } }` |
| `timeline.import` | `{ file }` |
| `timeline.replay` | `{ b, r?: { from?, to? } }` |
| `timeline.saves` | — |
| `timeline.events` | `{ opts?: { from?, kinds?, limit? } }` — unfiltered by visibility |

### Entities & fields

| Method | Params |
|--------|--------|
| `entities.generate` | `{ r: { kind, template, hints? } }` |
| `entities.promote` | `{ id, to: Lod }` |
| `fields.declare` | `{ f: FieldDef }` |
| `fields.grant` | `{ f: FieldDef }` |
| `fields.revoke` | `{ id }` |

### Director

| Method | Params |
|--------|--------|
| `director.sidenote` | `{ npc, text, o?: { ttlTurns?, verbatim? } }` |
| `director.invokeException` | `{ id, target }` |

### Introspect

| Method | Params |
|--------|--------|
| `query` | `{ viewer, path }` — uses `queryAsync` when available |
| `grant` | `{ viewer, path, ttl? }` |
| `explain` | `{ turnId, viewer }` |
| `purge` | `{ scope }` |

### Cards

| Method | Params |
|--------|--------|
| `importCard` | `{ file }` |
| `exportCard` | `{ id }` |

### Subscriptions

| Method | Params |
|--------|--------|
| `subscribe` | `{ kinds: string[] }` — `"*"` for all `EVENT_KINDS` |
| `unsubscribe` | — |

### Blocked (not exposed over RPC)

`rules.register`, `hooks.register`, `introspect.registerViewer`.

## Example session

```json
{"jsonrpc":"2.0","id":1,"method":"subscribe","params":{"kinds":["utterance","track.delta"]}}
{"jsonrpc":"2.0","id":2,"method":"scene.start","params":{"location":"home","participants":["player","guide"]}}
{"jsonrpc":"2.0","id":3,"method":"scene.turn","params":{"sceneId":"scn_0001","actor":"player","text":"Hello","addressee":"guide"}}
```

While id 3 runs, stdout may interleave:

```json
{"jsonrpc":"2.0","method":"turn.chunk","params":{"requestId":3,"chunk":{"type":"text","text":"Hi"}}}
{"jsonrpc":"2.0","method":"event","params":{"kind":"track.delta","event":{...}}}
```

Response:

```json
{"jsonrpc":"2.0","id":3,"result":{"events":["evt_..."], "chunks":[...], "summary":{"turnId":"turn_0001"}}}
```

### Gallery

| Method | Params | Result |
|--------|--------|--------|
| `gallery.list` | `{ opts?: GalleryListOptions }` | `GalleryItemView[]` |
| `gallery.get` | `{ id, opts? }` | `GalleryItemView \| null` |
| `gallery.ratings` | — | `GalleryRatingView[]` |
| `gallery.unlock` | `{ id, why? }` | `GalleryItemView` |
| `gallery.capture` | `{ req?: GalleryCaptureRequest }` | `{ item, job }` |
| `gallery.render` | `{ id, opts? }` | `{ job }` |
| `gallery.cancel` | `{ job }` | `boolean` |
| `gallery.remove` | `{ id }` | `null` |
| `gallery.pin` | `{ id, pinned }` | `null` |
| `gallery.jobs` | — | `GalleryJobView[]` |
| `gallery.image` | `{ id }` | `{ ref, base64 } \| null` (decoded cap 12 MiB; null when locked/unavailable) |

See [gallery.md](./gallery.md) for types and gating rules.

See [embedding.md](./embedding.md) for Python stdio example.
