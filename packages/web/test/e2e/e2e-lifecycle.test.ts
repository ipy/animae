import { describe, expect, test } from "bun:test";
import { createMemoryAssetProvider, createWebServer } from "../../src/index.ts";
import { openE2eStack } from "./e2e-fixture.ts";

describe("web e2e lifecycle", () => {
  test(
    "stop releases port for rebind and engine closes cleanly",
    async () => {
      const stack = await openE2eStack();
      const port = stack.handle.server.port!;
      stack.handle.stop();
      await stack.engine.close();

      const stack2 = await openE2eStack();
      try {
        const rebound = createWebServer({
          host: stack2.host,
          port,
          bindHost: "127.0.0.1",
          assets: createMemoryAssetProvider({
            "index.html": { body: "rebind", contentType: "text/html; charset=utf-8" },
          }),
        });
        try {
          expect(rebound.server.port).toBe(port);
          const res = await fetch(`http://127.0.0.1:${port}/`);
          expect(res.status).toBe(200);
          expect(await res.text()).toContain("rebind");
        } finally {
          rebound.stop();
        }
      } finally {
        await stack2.dispose();
      }
    },
    { timeout: 10_000 },
  );
});
