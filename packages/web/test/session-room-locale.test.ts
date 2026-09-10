import { test, expect, describe } from "bun:test";
import { SessionHost } from "@animae/host";
import { SessionRoom } from "../src/server/session-room.ts";
import type { Engine } from "@animae/engine";

function stubEngine(): Engine {
  return {
    world: { now: () => ({ day: 1, minute: 90 }) },
    query: () => ({}),
    timeline: { current: () => ({ name: "main" }), save: async () => ({ label: "s1", eventId: "evt_1" }) },
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

function snapshotFrom(ws: FakeWs): Record<string, unknown> | undefined {
  const snaps = ws.sent.filter((m) => (m as { type?: string }).type === "snapshot") as Array<{
    state?: Record<string, unknown>;
  }>;
  return snaps.at(-1)?.state;
}

describe("SessionRoom locale", () => {
  test("hello_ok negotiates locale and snapshots differ by client", async () => {
    const host = new SessionHost({ engine: stubEngine(), uiLocale: "en" });
    const room = new SessionRoom("sess", host, {
      host: "127.0.0.1",
      maxMessagesPerMinute: 1000,
      maxMessageBytes: 1_000_000,
      allowedOrigins: [],
    });

    const en = fakeWs("ws-en", "client-en");
    const zh = fakeWs("ws-zh", "client-zh");
    room.registerClient(en as never, en.data.id);
    room.registerClient(zh as never, zh.data.id);

    await room.handleMessage(
      en as never,
      JSON.stringify({ v: 1, type: "hello", role: "spectator", clientId: "client-en", locale: "en" }),
    );
    await room.handleMessage(
      zh as never,
      JSON.stringify({ v: 1, type: "hello", role: "spectator", clientId: "client-zh", locale: "zh-CN" }),
    );

    const helloEn = en.sent.find((m) => (m as { type?: string }).type === "hello_ok") as {
      locale?: string;
      locales?: unknown[];
    };
    expect(helloEn?.locale).toBe("en");
    expect(helloEn?.locales?.length).toBeGreaterThan(0);

    const headerEn = (snapshotFrom(en)?.header as { time?: { label?: string } })?.time?.label ?? "";
    const headerZh = (snapshotFrom(zh)?.header as { time?: { label?: string } })?.time?.label ?? "";
    expect(headerEn).toContain("Day");
    expect(headerZh).toContain("第");
    expect(headerEn).not.toBe(headerZh);
  });

  test("set_locale refreshes localized snapshot", async () => {
    const host = new SessionHost({ engine: stubEngine(), uiLocale: "en" });
    const room = new SessionRoom("sess", host, {
      host: "127.0.0.1",
      maxMessagesPerMinute: 1000,
      maxMessageBytes: 1_000_000,
      allowedOrigins: [],
    });
    const ws = fakeWs("ws-a", "client-a");
    room.registerClient(ws as never, ws.data.id);
    await room.handleMessage(
      ws as never,
      JSON.stringify({ v: 1, type: "hello", role: "controller", clientId: "client-a", locale: "en" }),
    );
    const before = (snapshotFrom(ws)?.header as { time?: { label?: string } })?.time?.label;
    await room.handleMessage(ws as never, JSON.stringify({ v: 1, type: "set_locale", id: "l1", locale: "zh-CN" }));
    const after = (snapshotFrom(ws)?.header as { time?: { label?: string } })?.time?.label;
    expect(before).toContain("Day");
    expect(after).toContain("第");
  });

  test("unsupported locale falls back to en", async () => {
    const host = new SessionHost({ engine: stubEngine(), uiLocale: "en" });
    const room = new SessionRoom("sess", host, {
      host: "127.0.0.1",
      maxMessagesPerMinute: 1000,
      maxMessageBytes: 1_000_000,
      allowedOrigins: [],
    });
    const ws = fakeWs("ws-a", "client-a");
    room.registerClient(ws as never, ws.data.id);
    await room.handleMessage(
      ws as never,
      JSON.stringify({ v: 1, type: "hello", role: "spectator", clientId: "client-a", locale: "de-DE" }),
    );
    const hello = ws.sent.find((m) => (m as { type?: string }).type === "hello_ok") as { locale?: string };
    expect(hello?.locale).toBe("en");
  });

  test("errors localize per client locale", async () => {
    const host = new SessionHost({ engine: stubEngine() });
    const room = new SessionRoom("sess", host, {
      host: "127.0.0.1",
      maxMessagesPerMinute: 1000,
      maxMessageBytes: 1_000_000,
      allowedOrigins: [],
    });
    const ws = fakeWs("ws-a", "client-a");
    room.registerClient(ws as never, ws.data.id);
    await room.handleMessage(
      ws as never,
      JSON.stringify({ v: 1, type: "hello", role: "controller", clientId: "client-a", locale: "zh-CN" }),
    );
    await room.handleMessage(ws as never, JSON.stringify({ v: 1, type: "input", id: "in1", text: "hi" }));
    const err = ws.sent.find((m) => (m as { type?: string }).type === "error") as { message?: string; code?: string };
    expect(err?.code).toBe("NO_SCENE");
    expect(err?.message).toContain("场景");
  });
});
