import { test, expect, describe } from "bun:test";
import { SessionHost } from "@animae/host";
import { SessionRoom } from "../src/server/session-room.ts";
import type { Engine } from "@animae/engine";

import { baseStubEngine } from "./helpers/stub-engine.ts";

function stubEngine(): Engine {
  return baseStubEngine();
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

type Build = () => Promise<Record<string, unknown>>;

async function connectedRoom(build: Build): Promise<{ room: SessionRoom; ws: FakeWs }> {
  const host = new SessionHost({ engine: stubEngine() });
  (host as unknown as { buildSnapshot: Build }).buildSnapshot = build;
  const room = new SessionRoom("sess", host, security);
  const ws = fakeWs("ws-a", "client-a");
  room.registerClient(ws as never, ws.data.id);
  await room.handleMessage(ws as never, JSON.stringify({ v: 1, type: "hello", role: "controller", clientId: "client-a" }));
  return { room, ws };
}

const tick = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("SessionRoom snapshot pump", () => {
  test("overlapping pushes never build snapshots concurrently and coalesce into one follow-up", async () => {
    let live = 0;
    let maxLive = 0;
    let builds = 0;
    let counter = 0;
    const { room, ws } = await connectedRoom(async () => {
      live += 1;
      maxLive = Math.max(maxLive, live);
      builds += 1;
      const value = counter;
      await tick(10);
      live -= 1;
      return { value };
    });
    const buildsAfterHello = builds;

    const pushes: Array<Promise<void>> = [];
    for (let i = 0; i < 6; i++) {
      counter = i + 1;
      pushes.push(room.pushSnapshot());
    }
    await Promise.all(pushes);

    expect(maxLive).toBe(1);
    // One run that was already underway when the burst started plus a single coalesced follow-up.
    expect(builds - buildsAfterHello).toBeLessThanOrEqual(2);
    const states = ws.sent.filter((m) => m.type === "snapshot" || m.type === "patch");
    expect(states.length).toBeGreaterThan(0);
  });

  test("a caller's promise settles only after a build that started after the call", async () => {
    let counter = 0;
    const seen: number[] = [];
    const { room } = await connectedRoom(async () => {
      const value = counter;
      seen.push(value);
      await tick(10);
      return { value };
    });
    seen.length = 0;

    const first = room.pushSnapshot();
    await tick(2); // first build is mid-flight and has already read counter = 0
    counter = 42;
    await room.pushSnapshot(); // must wait for a build that observes counter = 42
    expect(seen.at(-1)).toBe(42);
    await first;
  });

  test("a failing build rejects waiting callers and does not wedge later pushes", async () => {
    let broken = false;
    const { room, ws } = await connectedRoom(async () => {
      if (broken) throw new Error("snapshot exploded");
      return { ok: true };
    });
    broken = true;
    await expect(room.pushSnapshot()).rejects.toThrow("snapshot exploded");
    broken = false;
    const before = ws.sent.length;
    await room.pushSnapshot(true);
    expect(ws.sent.length).toBeGreaterThan(before);
    expect(ws.sent.at(-1)?.type).toBe("snapshot");
  });

  test("forceFull requested mid-run is honoured by the follow-up run", async () => {
    let counter = 0;
    const { room, ws } = await connectedRoom(async () => {
      const value = counter;
      await tick(8);
      return { value };
    });
    const running = room.pushSnapshot();
    await tick(2);
    counter = 7;
    const forced = room.pushSnapshot(true);
    await Promise.all([running, forced]);
    const last = ws.sent.at(-1);
    expect(last?.type).toBe("snapshot");
    expect((last?.state as { value?: number } | undefined)?.value).toBe(7);
  });
});
