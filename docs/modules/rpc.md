# JSON-RPC (`engine/src/rpc`)

## Purpose

Newline-delimited JSON-RPC 2.0 sidecar over any duplex stream. Method names mirror the public `Engine` API (`scene.turn`, `timeline.rewind`, `query`, …). Used by `animae serve --stdio`.

## Public API

| Export | Description |
|---|---|
| `createRpcServer(engine, io)` | `{ run(): Promise<void>; close() }` |
| `RpcIo` | `{ read: AsyncIterable<string \| Uint8Array>; write(line: string): void }` |
| `readLines(read)` | Split async byte/text input into lines |

## Protocol

- Requests/responses: one JSON object per line on `io.write` / stdin. **Only JSON-RPC** goes to stdout; logs belong on stderr (CLI responsibility).
- Streaming: `scene.turn` and `timeline.replay` emit `turn.chunk` notifications `{ requestId, chunk }` (`TurnChunk`: `text`, `narration`, `cue`, `choices`, `reset`, `done`), then a final result `{ events, chunks, summary? }`.
- Runtime: `runtime.mode` → `{ mode, pending, switchAt, models }`; `runtime.setMode` → `{ before, after, pending }` (same as `Engine.runtime.setMode`).
- Subscriptions: `subscribe({ kinds: string[] })` / `unsubscribe`; matching engine events push `event` notifications `{ kind, event }`. `"*"` subscribes to all known kinds.
- Errors: JSON-RPC `-32700` … `-32603`; `AnimaeError` → `-32603` with `error.data.code`.
- Concurrency: requests run concurrently; `scene.turn` and `timeline.replay` are serialized (one active call each).
- Also exposed: `setUiLocale`, `display.resolve`, `display.entityDisplayName`, `mods`, `entities.setAlias`, `entities.spawn`, `entities.retire`, `entities.generateFromBrief`; `scene.turn` accepts optional `outputLocale`.
- Not exposed: `close`, `rules.register`, `hooks.register`, `introspect.registerViewer` (unknown method → `-32601`).

## Edge cases

- Invalid JSON → `-32700`; malformed request → `-32600`; unknown method → `-32601`.
- Client notifications (except ignored `ping`) → `-32600`.
- Params may be positional arrays or named objects (`paramsObject` in `params.ts`).

## Tests

`engine/test/rpc/` — fake engine, duplex helper, protocol rules, real `createEngine` smoke test.
