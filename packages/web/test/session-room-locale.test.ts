import { test, expect, describe } from "bun:test";
import { SessionHost } from "@animae/host";
import { getRequestLocale } from "@animae/i18n";
import { SessionRoom } from "../src/server/session-room.ts";
import type { Engine } from "@animae/engine";
import { galleryStub } from "./helpers/stub-engine.ts";

function stubEngine(): Engine {
  return {
    world: { now: () => ({ day: 1, minute: 90 }) },
    query: () => ({}),
    timeline: { current: () => ({ name: "main" }), save: async () => ({ label: "s1", eventId: "evt_1" }) },
    scene: { start: async () => "s", end: async () => {}, turn: async function* () {} },
    mods: () => null,
    on: () => () => {},
    gallery: galleryStub(),
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

describe("SessionRoom request locale scope", () => {
  const security = { host: "127.0.0.1", maxMessagesPerMinute: 1000, maxMessageBytes: 1_000_000, allowedOrigins: [] };

  /** Engine whose timeline calls record the locale scope they run in. */
  function recordingEngine(seen: Record<string, string | undefined>): Engine {
    const mark = (key: string) => {
      seen[key] = getRequestLocale()?.locale;
    };
    return {
      world: { now: () => ({ day: 1, minute: 0 }) },
      query: () => ({}),
      timeline: {
        current: () => ({ name: "main" }),
        save: async () => {
          mark("save");
          return { label: "s", eventId: "e" };
        },
        rewind: async () => mark("rewind"),
        switch: async () => mark("branch"),
        load: async () => mark("load"),
      },
      scene: { start: async () => "s", end: async () => {}, turn: async function* () {} },
      mods: () => null,
      on: () => () => {},
      gallery: galleryStub(),
    } as unknown as Engine;
  }

  async function joinClient(room: SessionRoom, id: string, locale: string): Promise<FakeWs> {
    const ws = fakeWs(`ws-${id}`, `client-${id}-xxxxxxxx`);
    room.registerClient(ws as never, ws.data.id);
    await room.handleMessage(
      ws as never,
      JSON.stringify({ v: 1, type: "hello", role: "controller", clientId: ws.data.clientId, locale }),
    );
    return ws;
  }

  test("every frame that reaches the game runs in the sending client's locale", async () => {
    const seen: Record<string, string | undefined> = {};
    const host = new SessionHost({ engine: recordingEngine(seen), uiLocale: "en" });
    const mark = (key: string) => {
      seen[key] = getRequestLocale()?.locale;
    };
    const h = host as unknown as Record<string, unknown>;
    h.runCommand = async () => mark("command");
    h.runAction = async () => mark("action");
    h.submitInput = async (text: string) => mark(text ? "input" : "choose");
    const room = new SessionRoom("sess", host, security);
    const zh = await joinClient(room, "zh", "zh-CN");

    const frames: Array<[string, Record<string, unknown>]> = [
      ["input", { text: "hello" }],
      ["choose", { choiceId: "c1" }],
      ["command", { name: "help", args: [] }],
      ["action", { actionId: "end_day", args: {} }],
      ["save", {}],
      ["load", { slot: "s1" }],
      ["rewind", { eventId: "e1" }],
      ["branch", { name: "alt" }],
    ];
    for (const [type, extra] of frames) {
      await room.handleMessage(zh as never, JSON.stringify({ v: 1, type, id: `req-${type}`, ...extra }));
    }

    expect(seen).toEqual({
      input: "zh-CN",
      choose: "zh-CN",
      command: "zh-CN",
      action: "zh-CN",
      save: "zh-CN",
      load: "zh-CN",
      rewind: "zh-CN",
      branch: "zh-CN",
    });
    // Nothing leaks into code running outside a frame.
    expect(getRequestLocale()).toBeUndefined();
  });

  test("event frames keep their shape and localize only the values inside them", async () => {
    let emit: ((e: unknown) => void) | undefined;
    const engine = {
      ...(stubEngine() as unknown as Record<string, unknown>),
      on: (_kind: string, handler: (e: unknown) => void) => {
        emit = handler;
        return () => {};
      },
    } as unknown as Engine;
    const host = new SessionHost({ engine, uiLocale: "en" });
    const room = new SessionRoom("sess", host, security);
    const zh = await joinClient(room, "zh", "zh-CN");
    zh.sent.length = 0;

    // A root-level `i18n` field used to turn the entire event into a bare string.
    emit!({
      kind: "info_arrival",
      id: "evt_1",
      i18n: { key: "error.read_only" },
      detail: { $t: "error.read_only" },
      nested: [{ i18n: { key: "error.read_only" } }],
    });

    const frame = zh.sent.find((m) => (m as { type?: string }).type === "event") as {
      kind: string;
      payload: Record<string, unknown>;
    };
    expect(frame.kind).toBe("info_arrival");
    expect(typeof frame.payload).toBe("object");
    expect(frame.payload.kind).toBe("info_arrival");
    expect(frame.payload.id).toBe("evt_1");
    expect(frame.payload.i18n).toEqual({ key: "error.read_only" });
    expect(frame.payload.detail).toBe("旁观者无法控制会话");
    expect(frame.payload.nested).toEqual(["旁观者无法控制会话"]);
  });

  test("snapshots are built in each client's own locale scope, whoever triggered the push", async () => {
    const host = new SessionHost({ engine: stubEngine(), uiLocale: "en" });
    const builds: Array<{ asked: string | undefined; scope: string | undefined }> = [];
    const real = host.buildSnapshot.bind(host);
    host.buildSnapshot = async (opts) => {
      builds.push({ asked: opts?.locale, scope: getRequestLocale()?.locale });
      return real(opts);
    };
    const room = new SessionRoom("sess", host, security);
    const en = await joinClient(room, "en", "en");
    const zh = await joinClient(room, "zh", "zh-CN");
    builds.length = 0;

    // A request from the English client triggers a push to both clients.
    await room.handleMessage(en as never, JSON.stringify({ v: 1, type: "select_focus", id: "f1" }));

    expect(builds.length).toBeGreaterThanOrEqual(2);
    for (const b of builds) expect(b.scope).toBe(b.asked);
    expect(new Set(builds.map((b) => b.scope))).toEqual(new Set(["en", "zh-CN"]));
    expect(zh.sent.length).toBeGreaterThan(0);
  });
});
