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

## Reference client

`ref-client/index.html` — single-file proof UI (no build step). Host games embed or copy it into `web/dist`.
