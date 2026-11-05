import { afterEach, describe, expect, test } from "bun:test";
import { createDirectoryAssetProvider } from "../../src/assets/directory-provider.ts";
import { openE2eStack } from "./e2e-fixture.ts";

const stacks: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (stacks.length) await stacks.pop()!();
});

describe("web e2e HTTP", () => {
  test("serves index and static assets with security headers", async () => {
    const stack = await openE2eStack();
    stacks.push(() => stack.dispose());
    const index = await fetch(`${stack.baseUrl}/`);
    expect(index.status).toBe(200);
    expect(index.headers.get("content-type")).toContain("text/html");
    expect(index.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(index.headers.get("x-frame-options")).toBe("DENY");
    expect(await index.text()).toContain("web e2e");

    const js = await fetch(`${stack.baseUrl}/app.js`);
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toContain("javascript");
  });

  test("health and version JSON endpoints", async () => {
    const stack = await openE2eStack();
    stacks.push(() => stack.dispose());
    const health = await fetch(`${stack.baseUrl}/api/health`);
    expect(health.status).toBe(200);
    const healthBody = (await health.json()) as { ok?: boolean; sessionId?: string };
    expect(healthBody.ok).toBe(true);
    expect(typeof healthBody.sessionId).toBe("string");

    const version = await fetch(`${stack.baseUrl}/api/version`);
    expect(version.status).toBe(200);
    const ver = (await version.json()) as { protocol?: number; package?: string };
    expect(ver.protocol).toBe(1);
    expect(ver.package).toBe("@animae/web");
  });

  test("SPA fallback for unknown page paths and 404 for environment without hook", async () => {
    const stack = await openE2eStack();
    stacks.push(() => stack.dispose());
    const missing = await fetch(`${stack.baseUrl}/no-such-page`);
    expect(missing.status).toBe(200);
    expect(await missing.text()).toContain("web e2e");
    const env = await fetch(`${stack.baseUrl}/api/environment`);
    expect(env.status).toBe(404);
  });

  test("directory asset provider blocks traversal at lookup", async () => {
    const stack = await openE2eStack({ assets: "directory" });
    stacks.push(() => stack.dispose());
    expect(stack.assetRoot).toBeTruthy();
    const provider = createDirectoryAssetProvider(stack.assetRoot!);
    expect(await provider.get("../index.html")).toBeNull();
    expect(await provider.get("../../etc/passwd")).toBeNull();
  });

  test("gallery image HTTP route rejects traversal in entry id", async () => {
    const stack = await openE2eStack();
    stacks.push(() => stack.dispose());
    const res = await fetch(`${stack.baseUrl}/api/gallery/image/..%2Fsecret`);
    expect(res.status).toBe(404);
  });

  test("origin allow-list uses bound port when listening on port 0", async () => {
    const stack = await openE2eStack();
    stacks.push(() => stack.dispose());
    const allowed = await fetch(`${stack.baseUrl}/`, {
      headers: { origin: stack.baseUrl.replace(/\/$/, "") },
    });
    expect(allowed.status).toBe(200);
    const denied = await fetch(`${stack.baseUrl}/`, { headers: { origin: "http://evil.test" } });
    expect(denied.status).toBe(403);
  });

  test("gallery image route 404 for unknown entry id", async () => {
    const stack = await openE2eStack();
    stacks.push(() => stack.dispose());
    const res = await fetch(`${stack.baseUrl}/api/gallery/image/no-such-entry`);
    expect(res.status).toBe(404);
  });
});
