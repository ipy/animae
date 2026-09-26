import { describe, expect, test } from "bun:test";
import { SessionHost } from "@animae/host";
import { ClientMessageSchema } from "../src/protocol/schemas.ts";
import { SessionRoom, type WebSessionHooks } from "../src/server/session-room.ts";
import { baseStubEngine } from "./helpers/stub-engine.ts";

type FakeWs = {
  data: { id: string; clientId: string; role: "controller" | "spectator"; authenticated: boolean; messageTimes: number[]; locale: string };
  send: (s: string) => void;
  sent: Record<string, unknown>[];
};

function fakeWs(id: string, clientId: string): FakeWs {
  const sent: Record<string, unknown>[] = [];
  return {
    data: { id, clientId, role: "spectator", authenticated: false, messageTimes: [], locale: "en" },
    sent,
    send(s: string) {
      sent.push(JSON.parse(s) as Record<string, unknown>);
    },
  };
}

const security = { host: "127.0.0.1", maxMessagesPerMinute: 1000, maxMessageBytes: 1_000_000, allowedOrigins: [] };

async function connect(room: SessionRoom, ws: FakeWs, role: "controller" | "spectator"): Promise<void> {
  room.registerClient(ws as never, ws.data.id);
  await room.handleMessage(ws as never, JSON.stringify({ v: 1, type: "hello", role, clientId: ws.data.clientId }));
}

describe("images_probe", () => {
  test("schema accepts an optional draft object and rejects other shapes", () => {
    expect(ClientMessageSchema.safeParse({ v: 1, type: "images_probe", id: "p1" }).success).toBe(true);
    expect(ClientMessageSchema.safeParse({ v: 1, type: "images_probe", id: "p1", draft: { provider: "none" } }).success).toBe(true);
    expect(ClientMessageSchema.safeParse({ v: 1, type: "images_probe", id: "p1", draft: "x" }).success).toBe(false);
    expect(ClientMessageSchema.safeParse({ v: 1, type: "images_probe" }).success).toBe(false);
  });

  test("controller reaches the host hook with the unsaved draft and gets its result", async () => {
    const seen: (Record<string, unknown> | undefined)[] = [];
    const hooks: WebSessionHooks = {
      async imagesProbe(draft) {
        seen.push(draft);
        return { ok: true, lines: ["ready"] };
      },
    };
    const room = new SessionRoom("sess", new SessionHost({ engine: baseStubEngine() }), security, hooks);
    const ws = fakeWs("ws-a", "client-a");
    await connect(room, ws, "controller");
    await room.handleMessage(ws as never, JSON.stringify({ v: 1, type: "images_probe", id: "p1", draft: { provider: "a1111" } }));
    expect(seen).toEqual([{ provider: "a1111" }]);
    const reply = ws.sent.find((m) => m.type === "result" && m.id === "p1");
    expect(reply).toMatchObject({ ok: true, data: { ok: true, lines: ["ready"] } });
  });

  test("without a host hook the request fails as unsupported", async () => {
    const room = new SessionRoom("sess", new SessionHost({ engine: baseStubEngine() }), security, {});
    const ws = fakeWs("ws-a", "client-a");
    await connect(room, ws, "controller");
    await room.handleMessage(ws as never, JSON.stringify({ v: 1, type: "images_probe", id: "p2" }));
    expect(ws.sent.find((m) => m.type === "error" && m.id === "p2")).toMatchObject({ code: "UNSUPPORTED" });
  });

  test("spectators are read-only", async () => {
    let called = false;
    const room = new SessionRoom("sess", new SessionHost({ engine: baseStubEngine() }), security, {
      async imagesProbe() {
        called = true;
        return {};
      },
    });
    const controller = fakeWs("ws-a", "client-a");
    const spectator = fakeWs("ws-b", "client-b");
    await connect(room, controller, "controller");
    await connect(room, spectator, "controller");
    expect(spectator.data.role).toBe("spectator");
    await room.handleMessage(spectator as never, JSON.stringify({ v: 1, type: "images_probe", id: "p3" }));
    expect(called).toBe(false);
    expect(spectator.sent.find((m) => m.type === "error" && m.id === "p3")).toMatchObject({ code: "READ_ONLY" });
  });
});
