import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDirectoryAssetProvider } from "../src/assets/directory-provider.ts";
import { serveAssetRequest } from "../src/assets/serve-asset.ts";

const roots: string[] = [];
afterEach(async () => {
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "animae-assets-"));
  roots.push(root);
  await writeFile(join(root, "index.html"), "<html></html>", "utf8");
  await writeFile(join(root, "app.js"), "console.log(1);", "utf8");
  await mkdir(join(root, "nested"), { recursive: true });
  await writeFile(join(root, "nested", "x.json"), "{}", "utf8");
  return root;
}

test("directory provider rejects path traversal", async () => {
  const root = await fixture();
  const provider = createDirectoryAssetProvider(root);
  expect(await provider.get("../secret")).toBeNull();
  expect(await provider.get("/../../etc/passwd")).toBeNull();
});

test("directory provider serves files with content type and etag", async () => {
  const root = await fixture();
  const provider = createDirectoryAssetProvider(root);
  const html = await provider.get("index.html");
  expect(html?.contentType).toContain("text/html");
  expect(html?.etag).toMatch(/^"/);
  const js = await provider.get("app.js");
  expect(js?.contentType).toContain("javascript");
  expect(await provider.get("missing.bin")).toBeNull();
});

test("304 when if-none-match matches etag", async () => {
  const root = await fixture();
  const provider = createDirectoryAssetProvider(root);
  const entry = await provider.get("index.html");
  const res = await serveAssetRequest(provider, "/index.html", new Request("http://x/", { headers: { "if-none-match": entry!.etag } }));
  expect(res.status).toBe(304);
});

test("gzip/br encoding for large bodies", async () => {
  const root = await fixture();
  const big = "x".repeat(400);
  await writeFile(join(root, "big.txt"), big, "utf8");
  const provider = createDirectoryAssetProvider(root);
  const br = await serveAssetRequest(provider, "/big.txt", new Request("http://x/", { headers: { "accept-encoding": "br, gzip" } }));
  expect(br.headers.get("content-encoding")).toBe("br");
  const gz = await serveAssetRequest(provider, "/big.txt", new Request("http://x/", { headers: { "accept-encoding": "gzip" } }));
  expect(gz.headers.get("content-encoding")).toBe("gzip");
});
