import { afterEach, expect, test } from "bun:test";
import { SessionHost } from "@animae/host";
import { createMemoryAssetProvider, createWebServer } from "../src/index.ts";
import { baseStubEngine } from "./helpers/stub-engine.ts";

let stop: (() => void) | undefined;

afterEach(() => {
  stop?.();
  stop = undefined;
});

function openServer(extra: Omit<Parameters<typeof createWebServer>[0], "host"> & { host?: SessionHost }) {
  const host = extra.host ?? new SessionHost({ engine: baseStubEngine(), initialMessage: "ready" });
  const handle = createWebServer({ ...extra, host });
  stop = () => handle.stop();
  const port = handle.server.port!;
  const base = `http://127.0.0.1:${port}`;
  return { handle, base, host };
}

test("GET /api/version and /api/client-catalog", async () => {
  const { base } = openServer({
    port: 0,
    assets: createMemoryAssetProvider({ "index.html": { body: "ok", contentType: "text/html" } }),
    version: "9.9.9-test",
  });
  const ver = (await (await fetch(`${base}/api/version`)).json()) as { app: string; package: string };
  expect(ver.app).toBe("9.9.9-test");
  expect(ver.package).toBe("@animae/web");
  const cat = (await (await fetch(`${base}/api/client-catalog?locale=en`)).json()) as {
    locale: string;
    catalog: Record<string, string>;
  };
  expect(cat.locale).toBe("en");
  expect(typeof cat.catalog).toBe("object");
});

test("onApiRequest hook can short-circuit before gallery routes", async () => {
  const { base } = openServer({
    port: 0,
    assets: createMemoryAssetProvider({ "index.html": { body: "x", contentType: "text/html" } }),
    onApiRequest: async (_req, url) => {
      if (url.pathname === "/api/ping") return Response.json({ pong: true });
      return undefined;
    },
  });
  const res = await fetch(`${base}/api/ping`);
  expect(((await res.json()) as { pong: boolean }).pong).toBe(true);
});

test("GET /ws without upgrade returns 426", async () => {
  const { base } = openServer({
    port: 0,
    assets: createMemoryAssetProvider({ "index.html": { body: "x", contentType: "text/html" } }),
  });
  const res = await fetch(`${base}/ws`);
  expect(res.status).toBe(426);
});

test("forbidden Origin on static assets", async () => {
  const { base } = openServer({
    port: 0,
    assets: createMemoryAssetProvider({ "index.html": { body: "x", contentType: "text/html" } }),
  });
  const res = await fetch(`${base}/index.html`, { headers: { origin: "http://evil.example" } });
  expect(res.status).toBe(403);
});

test("websocket rejects oversized messages", async () => {
  const { base, handle } = openServer({
    port: 0,
    assets: createMemoryAssetProvider({ "index.html": { body: "x", contentType: "text/html" } }),
    authToken: "tok",
  });
  const ws = new WebSocket(`${base.replace("http", "ws")}/ws?token=tok`);
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error("ws open failed"));
  });
  const max = handle.security.maxMessageBytes;
  const closed = new Promise<void>((resolve) => {
    ws.onclose = () => resolve();
  });
  ws.send("x".repeat(max + 1));
  await closed;
  expect(ws.readyState).toBe(WebSocket.CLOSED);
});
