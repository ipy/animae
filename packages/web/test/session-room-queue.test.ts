import { test, expect, describe } from "bun:test";
import { SessionHost } from "@animae/host";
import { SessionRoom } from "../src/server/session-room.ts";
import type { Engine } from "@animae/engine";

function stubEngine(): Engine {
  return {
    world: { now: () => ({ day: 1, minute: 0 }) },
    query: () => ({}),
    timeline: { current: () => ({ name: "main" }) },
    scene: { start: async () => "s", end: async () => {}, turn: async function* () {} },
    mods: () => null,
    on: () => () => {},
  } as unknown as Engine;
}

type FakeWs = {
  data: {
    id: string;
    clientId: string;
    role: "controller" | "spectator";
    authenticated: boolean;
    messageTimes: number[];
    locale: string;
  };
  send: (s: string) => void;
  sent: Array<Record<string, unknown>>;
};

function fakeWs(id: string, clientId: string): FakeWs {
  const sent: Array<Record<string, unknown>> = [];
  return {
    data: { id, clientId, role: "spectator", authenticated: false, messageTimes: [], locale: "en" },
    sent,
    send(s: string) {
      sent.push(JSON.parse(s) as Record<string, unknown>);
    },
  };
}

const security = { host: "127.0.0.1", maxMessagesPerMinute: 1000, maxMessageBytes: 1_000_000, allowedOrigins: [] };

async function connectedRoom(host: SessionHost): Promise<{ room: SessionRoom; ws: FakeWs }> {
  const room = new SessionRoom("sess", host, security);
  const ws = fakeWs("ws-a", "client-a");
  room.registerClient(ws as never, ws.data.id);
  await room.handleMessage(ws as never, JSON.stringify({ v: 1, type: "hello", role: "controller", clientId: "client-a" }));
  return { room, ws };
}

function frame(type: string, id: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ v: 1, type, id, ...extra });
}

describe("SessionRoom inbound queue", () => {
  test("frames from one client run strictly one after another", async () => {
    const host = new SessionHost({ engine: stubEngine() });
    const log: string[] = [];
    let active = 0;
    let maxActive = 0;
    (host as unknown as { submitInput: SessionHost["submitInput"] }).submitInput = async (text: string) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      log.push(`start:${text}`);
      await new Promise((r) => setTimeout(r, 15));
      log.push(`end:${text}`);
      active -= 1;
    };
    const { room, ws } = await connectedRoom(host);

    await Promise.all([
      room.handleMessage(ws as never, frame("input", "i1", { text: "one" })),
      room.handleMessage(ws as never, frame("input", "i2", { text: "two" })),
      room.handleMessage(ws as never, frame("input", "i3", { text: "three" })),
    ]);

    expect(maxActive).toBe(1);
    expect(log).toEqual(["start:one", "end:one", "start:two", "end:two", "start:three", "end:three"]);
  });

  test("cancel overtakes the turn it is meant to stop", async () => {
    const host = new SessionHost({ engine: stubEngine() });
    let release: (() => void) | undefined;
    let cancelledWhileRunning = false;
    let turnFinished = false;
    (host as unknown as { submitInput: SessionHost["submitInput"] }).submitInput = async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      turnFinished = true;
    };
    (host as unknown as { cancelActive: SessionHost["cancelActive"] }).cancelActive = () => {
      cancelledWhileRunning = !turnFinished;
      release?.();
      return true;
    };
    const { room, ws } = await connectedRoom(host);

    const turn = room.handleMessage(ws as never, frame("input", "i1", { text: "long turn" }));
    await new Promise((r) => setTimeout(r, 5));
    expect(turnFinished).toBe(false);

    await room.handleMessage(ws as never, frame("cancel", "c1"));
    expect(cancelledWhileRunning).toBe(true);
    const cancelResult = ws.sent.find((m) => m.type === "result" && m.id === "c1");
    expect(cancelResult).toBeDefined();

    await turn;
    expect(turnFinished).toBe(true);
  });

  test("handleMessage settles even when the handler throws", async () => {
    const host = new SessionHost({ engine: stubEngine() });
    (host as unknown as { submitInput: SessionHost["submitInput"] }).submitInput = async () => {
      throw new Error("boom");
    };
    const { room, ws } = await connectedRoom(host);
    await room.handleMessage(ws as never, frame("input", "i1", { text: "hi" }));
    expect(ws.sent.some((m) => m.type === "error" && m.id === "i1")).toBe(true);
    // The queue stays usable after a failed frame.
    await room.handleMessage(ws as never, frame("input", "i2", { text: "again" }));
    expect(ws.sent.some((m) => m.type === "error" && m.id === "i2")).toBe(true);
  });
});
