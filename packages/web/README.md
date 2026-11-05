# `@animae/web`

HTTP + WebSocket server for browser frontends driving an `@animae/host` `SessionHost`.

## Quick start (library)

```typescript
import { SessionHost } from "@animae/host";
import { createWebServer, createDirectoryAssetProvider } from "@animae/web";

const host = new SessionHost({ engine, /* commands, actions, panels */ });

const { url, stop } = createWebServer({
  host,
  port: 7878,
  bindHost: "127.0.0.1",
  assets: createDirectoryAssetProvider("./web/dist"),
});

console.log(url);
```

## Docs

- [Protocol v1](./docs/protocol.md)
- Module notes: [`../../docs/modules/web.md`](../../docs/modules/web.md)

## Reference client (diagnostics)

`ref-client/` — static developer console (no build step): connection panel, read-only smoke tests, model call log viewer, snapshot/protocol feeds, and a controller-only console for manual frames. Served by the host at `/ref/` (same session auth token as the main UI via `?token=` on the page URL; token is sent only inside the `hello` frame and is redacted in on-page logs).

Assets: `index.html`, `app.css`, `js/*.js` (ES modules), locale JSON under `locales/`. Host games copy the tree into `web/dist/ref/` when embedding static assets.

Clients must handle WebSocket `stream` messages with `segment: "narration"` and `phase: "reset"` (see [protocol.md](./docs/protocol.md)).
