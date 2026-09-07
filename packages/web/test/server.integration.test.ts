import { expect, test, afterEach } from "bun:test";
import { createEngine, MemoryStorage, createScriptedModel } from "@animae/engine";
import { SessionHost } from "@animae/host";
import { createMemoryAssetProvider, createWebServer } from "../src/index.ts";
import { e2ePreset, seedE2eAuthored } from "../../engine/test/e2e/fixture.ts";

function scriptedModels() {
  let renderN = 0;
  const body = (req: { label?: string; schema?: { parse: (v: unknown) => unknown } }) => {
    if (req.label === "appraise") {
      return {
        type: "chat",
        intensity: 0.55,
        sincerity: 0.9,
        claims: [{ s: "npc1", p: "likes", o: "tavern" }],
        search_terms: ["tavern"],
        tags: ["social"],
        input_class: "normal",
      };
    }
    if (req.label === "reflect") {
      return { summaries: [], goal_changes: [], new_claims: [] };
    }
    return {
      text: `Hello from NPC ${++renderN}.`,
      cues: [{ type: "emotion", args: { mood: "warm" }, at: 0 }],
      intent_realized: "talk",
    };
  };
  return {
    s1: createScriptedModel("web/s1", body),
    s2: createScriptedModel("web/s2", body),
  };
}

async function openTestHost() {
  const storage = MemoryStorage("web-test");
  await seedE2eAuthored(storage);
  const engine = await createEngine({
    root: "/mem",
    ports: { storage },
    presets: [e2ePreset],
    models: scriptedModels(),
    modelMode: "record",
    seed: 42,
    sessionId: "web-test",
  });
  const host = new SessionHost({ engine, initialMessage: "ready" });
  const sceneId = await engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
  host.attachScene(sceneId);
  return { engine, host };
}

let stop: (() => void) | undefined;

afterEach(() => {
  stop?.();
  stop = undefined;
});

test(
  "websocket play turn with stub model",
  async () => {
  const { engine, host } = await openTestHost();
  const port = 18000 + Math.floor(Math.random() * 1000);
  const handle = createWebServer({
    host,
    port,
    bindHost: "127.0.0.1",
    assets: createMemoryAssetProvider({
      "index.html": { body: "x", contentType: "text/html; charset=utf-8" },
    }),
  });
  stop = () => {
    handle.stop();
    void engine.close();
  };

  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error("ws open failed"));
  });

  const inbox = attachInbox(ws);
  ws.send(JSON.stringify({ v: 1, type: "hello", role: "controller" }));
  await inbox.wait((m) => m.type === "snapshot");

  const id = "turn1";
  ws.send(JSON.stringify({ v: 1, type: "input", id, text: "Hello" }));
  const result = await inbox.wait((m) => m.type === "result" && m.id === id);
  expect(result.ok).toBe(true);

  const seen = await inbox.wait((m) => {
    if (m.type === "stream" && String(m.text ?? "").includes("Hello")) return true;
    if (m.type === "snapshot") {
      const t = JSON.stringify((m.state as { transcript?: unknown })?.transcript ?? "");
      return t.includes("Hello");
    }
    return false;
  });
  expect(seen.type).toBeTruthy();
  },
  { timeout: 20_000 },
);

test("origin rejection on POST-like forbidden origin", async () => {
  const { engine, host } = await openTestHost();
  const port = 19000 + Math.floor(Math.random() * 1000);
  const handle = createWebServer({
    host,
    port,
    bindHost: "127.0.0.1",
    assets: createMemoryAssetProvider({
      "index.html": { body: "x", contentType: "text/html; charset=utf-8" },
    }),
    extraOrigins: ["http://allowed.test:1"],
  });
  stop = () => {
    handle.stop();
    void engine.close();
  };

  const bad = await fetch(`http://127.0.0.1:${port}/`, { headers: { origin: "http://evil.test" } });
  expect(bad.status).toBe(403);
});

test("oversize websocket message closes connection", async () => {
  const { engine, host } = await openTestHost();
  const port = 21000 + Math.floor(Math.random() * 1000);
  const handle = createWebServer({
    host,
    port,
    bindHost: "127.0.0.1",
    assets: createMemoryAssetProvider({
      "index.html": { body: "x", contentType: "text/html; charset=utf-8" },
    }),
  });
  stop = () => {
    handle.stop();
    void engine.close();
  };

  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise<void>((r, j) => {
    ws.onopen = () => r();
    ws.onerror = j;
  });
  const huge = "x".repeat(300_000);
  ws.send(JSON.stringify({ v: 1, type: "hello", token: huge }));
  await new Promise<void>((resolve) => {
    ws.onclose = () => resolve();
  });
});

test("LAN bind requires token", async () => {
  const { engine, host } = await openTestHost();
  const port = 20000 + Math.floor(Math.random() * 1000);
  const handle = createWebServer({
    host,
    port,
    bindHost: "0.0.0.0",
    assets: createMemoryAssetProvider({
      "index.html": { body: "x", contentType: "text/html; charset=utf-8" },
    }),
  });
  stop = () => {
    handle.stop();
    void engine.close();
  };
  expect(handle.security.authToken).toBeTruthy();

  const noToken = await fetch(`http://127.0.0.1:${port}/api/health`);
  expect(noToken.status).toBe(401);

  const ok = await fetch(`http://127.0.0.1:${port}/api/health?token=${handle.security.authToken}`);
  expect(ok.status).toBe(200);
});

function attachInbox(ws: WebSocket) {
  const queue: Record<string, unknown>[] = [];
  ws.addEventListener("message", (ev) => {
    queue.push(JSON.parse(String(ev.data)) as Record<string, unknown>);
  });
  return {
    async wait(pred: (m: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> {
      const started = Date.now();
      while (Date.now() - started < 15_000) {
        const idx = queue.findIndex(pred);
        if (idx >= 0) return queue.splice(idx, 1)[0]!;
        await Bun.sleep(20);
      }
      throw new Error("timeout");
    },
  };
}
