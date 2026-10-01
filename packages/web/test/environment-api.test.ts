import { expect, test, afterEach } from "bun:test";
import { createEngine, MemoryStorage, createScriptedModel } from "@animae/engine";
import { SessionHost } from "@animae/host";
import { createMemoryAssetProvider, createWebServer } from "../src/index.ts";
import { e2ePreset, seedE2eAuthored } from "../../engine/test/e2e/fixture.ts";

async function openTestHost() {
  const storage = MemoryStorage("env-api");
  await seedE2eAuthored(storage);
  const engine = await createEngine({
    root: "/mem",
    ports: { storage },
    presets: [e2ePreset],
    models: {
      s1: createScriptedModel("s1", () => ({ text: "hi" })),
      s2: createScriptedModel("s2", () => ({ text: "hi" })),
    },
    modelMode: "record",
    seed: 1,
    sessionId: "env-api",
  });
  const host = new SessionHost({ engine, initialMessage: "ready" });
  return { engine, host };
}

// Consecutive ports inside a range no other test file uses: a closed server's keep-alive connection can answer a later
// request on a reused port, so two tests of this file must never share one.
let nextPort = 22100 + Math.floor(Math.random() * 300) * 4;

let stop: (() => void) | undefined;

afterEach(() => {
  stop?.();
  stop = undefined;
});

test("GET /api/environment returns 404 when hook is absent", async () => {
  const { engine, host } = await openTestHost();
  const port = nextPort++;
  const handle = createWebServer({
    host,
    port,
    bindHost: "127.0.0.1",
    assets: createMemoryAssetProvider({ "index.html": { body: "x", contentType: "text/html" } }),
  });
  stop = () => {
    handle.stop();
    void engine.close();
  };
  const res = await fetch(`http://127.0.0.1:${port}/api/environment`);
  expect(res.status).toBe(404);
});

test("GET /api/environment requires token on LAN bind", async () => {
  const { engine, host } = await openTestHost();
  const port = nextPort++;
  const handle = createWebServer({
    host,
    port,
    bindHost: "0.0.0.0",
    assets: createMemoryAssetProvider({ "index.html": { body: "x", contentType: "text/html" } }),
    hooks: {
      environment: () => [{ id: "demo", label: "Demo", value: "/tmp/demo", kind: "path" }],
    },
  });
  stop = () => {
    handle.stop();
    void engine.close();
  };
  const noToken = await fetch(`http://127.0.0.1:${port}/api/environment`);
  expect(noToken.status).toBe(401);
  const ok = await fetch(
    `http://127.0.0.1:${port}/api/environment?token=${encodeURIComponent(handle.security.authToken!)}`,
  );
  expect(ok.status).toBe(200);
  const body = (await ok.json()) as { entries: { id: string; value: string; label: string }[] };
  expect(body.entries[0]?.value).toBe("/tmp/demo");
  expect(body.entries[0]?.label).toBe("Demo");
  expect(body.entries[0]?.id).toBe("demo");
});

test("GET /api/environment returns hook payload on loopback", async () => {
  const { engine, host } = await openTestHost();
  const port = nextPort++;
  const handle = createWebServer({
    host,
    port,
    bindHost: "127.0.0.1",
    assets: createMemoryAssetProvider({ "index.html": { body: "x", contentType: "text/html" } }),
    hooks: {
      environment: async () => [
        { id: "hostDataDir", label: "Data", value: "/var/data", kind: "path" },
      ],
    },
  });
  stop = () => {
    handle.stop();
    void engine.close();
  };
  const res = await fetch(`http://127.0.0.1:${port}/api/environment?locale=en`);
  expect(res.status).toBe(200);
  const json = (await res.json()) as { entries: unknown[] };
  expect(json.entries).toHaveLength(1);
});
