import { expect, test } from "bun:test";
import { createMemoryAssetProvider } from "../src/assets/memory-provider.ts";
import { serveAssetRequest } from "../src/assets/serve-asset.ts";

test("memory asset provider serves index", async () => {
  const provider = createMemoryAssetProvider({
    "index.html": { body: "<html>ok</html>", contentType: "text/html; charset=utf-8" },
  });
  const entry = await provider.get("index.html");
  expect(entry?.body.length).toBeGreaterThan(0);
});

test("spa fallback", async () => {
  const provider = createMemoryAssetProvider({
    "index.html": { body: "spa", contentType: "text/html; charset=utf-8" },
  });
  const res = await serveAssetRequest(provider, "/missing", new Request("http://x/"), {
    spaFallback: "index.html",
  });
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("spa");
});
