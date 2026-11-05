import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine, MemoryStorage, type CreateEngineOptions, type Engine } from "@animae/engine";
import { SessionHost } from "@animae/host";
import { createDirectoryAssetProvider, createMemoryAssetProvider, createWebServer, type WebServerHandle } from "../../src/index.ts";
import { ServerMessageSchema, type ServerMessage } from "../../src/protocol/schemas.ts";
import { e2ePreset, seedE2eAuthored } from "../../../engine/test/e2e/fixture.ts";
import { seedGalleryEngineRoot } from "../../../engine/test/gallery/fixture.ts";
import { worldScriptedModels } from "../../../engine/test/e2e/world-fixture.ts";

export const E2E_DEADLINE_MS = 9_000;
export const POLL_MS = 12;

export function pollUntil<T>(fn: () => T | undefined, deadlineMs = E2E_DEADLINE_MS): Promise<T> {
  const start = Date.now();
  return (async () => {
    while (Date.now() - start < deadlineMs) {
      const v = fn();
      if (v !== undefined) return v;
      await Bun.sleep(POLL_MS);
    }
    throw new Error("pollUntil: deadline exceeded");
  })();
}

export function parseServerFrame(raw: string): ServerMessage {
  const parsed: unknown = JSON.parse(raw);
  const msg = ServerMessageSchema.safeParse(parsed);
  if (!msg.success) {
    throw new Error(`invalid server frame: ${msg.error.message}`);
  }
  return msg.data;
}

export class WsSession {
  readonly ws: WebSocket;
  readonly frames: ServerMessage[] = [];
  private openPromise: Promise<void>;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.openPromise = new Promise<void>((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error("WebSocket open failed"));
    });
    this.ws.addEventListener("message", (ev) => {
      this.frames.push(parseServerFrame(String(ev.data)));
    });
  }

  async ready(): Promise<void> {
    await this.openPromise;
  }

  send(obj: Record<string, unknown>): void {
    this.ws.send(JSON.stringify(obj));
  }

  maxSeq(): number {
    let max = 0;
    for (const f of this.frames) {
      if ("seq" in f && typeof f.seq === "number") max = Math.max(max, f.seq);
    }
    return max;
  }

  async wait(pred: (m: ServerMessage) => boolean, deadlineMs = E2E_DEADLINE_MS): Promise<ServerMessage> {
    return pollUntil(() => {
      const hit = this.frames.find(pred);
      return hit;
    }, deadlineMs);
  }

  drainSince(seq: number): ServerMessage[] {
    return this.frames.filter((f) => "seq" in f && typeof f.seq === "number" && f.seq > seq);
  }

  close(): void {
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.close();
    }
  }
}

export interface E2eStack {
  engine: Engine;
  host: SessionHost;
  handle: WebServerHandle;
  baseUrl: string;
  wsUrl: string;
  assetRoot?: string;
  dispose(): Promise<void>;
}

export interface OpenE2eStackOptions {
  seedGallery?: boolean;
  models?: CreateEngineOptions["models"];
  ports?: CreateEngineOptions["ports"];
  modelMode?: CreateEngineOptions["modelMode"];
  assets?: "memory" | "directory";
}

export async function openE2eStack(opts: OpenE2eStackOptions = {}): Promise<E2eStack> {
  const storage = MemoryStorage(`web-e2e-${Date.now()}`);
  if (opts.seedGallery) {
    await seedGalleryEngineRoot(storage);
  } else {
    await seedE2eAuthored(storage);
  }
  const engine = await createEngine({
    root: "/mem",
    ports: { storage, ...opts.ports },
    presets: [e2ePreset],
    models: opts.models ?? worldScriptedModels({ renderText: "Hello from NPC." }),
    modelMode: opts.modelMode ?? "record",
    seed: 42,
    sessionId: `web-e2e-${Date.now()}`,
  });
  const host = new SessionHost({ engine, initialMessage: "ready" });
  const sceneId = await engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
  host.attachScene(sceneId);

  let assetRoot: string | undefined;
  let assets = createMemoryAssetProvider({
    "index.html": { body: "<html>web e2e</html>", contentType: "text/html; charset=utf-8" },
    "app.js": { body: "console.log(1)", contentType: "text/javascript; charset=utf-8" },
  });
  if (opts.assets === "directory") {
    assetRoot = await mkdtemp(join(tmpdir(), "animae-web-e2e-assets-"));
    await writeFile(join(assetRoot, "index.html"), "<html>dir</html>", "utf8");
    assets = createDirectoryAssetProvider(assetRoot);
  }

  const handle = createWebServer({
    host,
    port: 0,
    bindHost: "127.0.0.1",
    assets,
    version: "e2e-test",
  });
  const port = handle.server.port ?? 0;
  const baseUrl = `http://127.0.0.1:${port}`;
  const wsUrl = `ws://127.0.0.1:${port}/ws`;

  return {
    engine,
    host,
    handle,
    baseUrl,
    wsUrl,
    assetRoot,
    async dispose() {
      handle.stop();
      await engine.close();
      if (assetRoot) await rm(assetRoot, { recursive: true, force: true });
    },
  };
}

export async function helloController(
  wsUrl: string,
  extra: Record<string, unknown> = {},
): Promise<WsSession> {
  const client = new WsSession(wsUrl);
  await client.ready();
  client.send({
    v: 1,
    type: "hello",
    role: "controller",
    clientId: "e2e-client-ctrl-01",
    ...extra,
  });
  await client.wait((m) => m.type === "hello_ok");
  await client.wait((m) => m.type === "snapshot");
  return client;
}
