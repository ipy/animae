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
  sent: unknown[];
};

function fakeWs(id: string, clientId: string): FakeWs {
  const sent: unknown[] = [];
  return {
    data: { id, clientId, role: "spectator", authenticated: false, messageTimes: [], locale: "en" },
    sent,
    send(s: string) {
      sent.push(JSON.parse(s));
    },
  };
}

describe("SessionRoom controller seat", () => {
  test("second connection with different clientId stays spectator until claim", async () => {
    const host = new SessionHost({ engine: stubEngine() });
    const room = new SessionRoom("sess", host, { host: "127.0.0.1", maxMessagesPerMinute: 1000, maxMessageBytes: 1_000_000, allowedOrigins: [] });

    const a = fakeWs("ws-a", "client-a");
    const b = fakeWs("ws-b", "client-b");
    room.registerClient(a as never, a.data.id);
    room.registerClient(b as never, b.data.id);

    await room.handleMessage(a as never, JSON.stringify({ v: 1, type: "hello", role: "controller", clientId: "client-a" }));
    expect(a.data.role).toBe("controller");

    await room.handleMessage(b as never, JSON.stringify({ v: 1, type: "hello", role: "controller", clientId: "client-b" }));
    expect(b.data.role).toBe("spectator");

    await room.handleMessage(
      b as never,
      JSON.stringify({ v: 1, type: "claim_controller", id: "c1", force: true }),
    );
    expect(b.data.role).toBe("controller");
    expect(a.data.role).toBe("spectator");
  });

  test("controller disconnect clears seat for immediate claim", async () => {
    const host = new SessionHost({ engine: stubEngine() });
    const room = new SessionRoom("sess", host, { host: "127.0.0.1", maxMessagesPerMinute: 1000, maxMessageBytes: 1_000_000, allowedOrigins: [] });
    const a = fakeWs("ws-a", "client-a");
    const b = fakeWs("ws-b", "client-b");
    room.registerClient(a as never, a.data.id);
    room.registerClient(b as never, b.data.id);

    await room.handleMessage(a as never, JSON.stringify({ v: 1, type: "hello", role: "controller", clientId: "client-a" }));
    room.removeClient("ws-a");

    await room.handleMessage(b as never, JSON.stringify({ v: 1, type: "hello", role: "controller", clientId: "client-b" }));
    expect(b.data.role).toBe("controller");
  });
});
