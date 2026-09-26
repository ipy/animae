import { test, expect, describe } from "bun:test";
import { SessionHost } from "@animae/host";
import { createModelCallLog, createScriptedModel, withModelCallLog } from "@animae/engine";
import { SessionRoom } from "../src/server/session-room.ts";
import type { Engine } from "@animae/engine";
import { z } from "zod";
import { galleryStub } from "./helpers/stub-engine.ts";

function engineWithLog(): Engine {
  const log = createModelCallLog();
  const schema = z.object({ ok: z.literal(true) });
  const port = withModelCallLog(
    createScriptedModel("stub/m", () => ({ ok: true as const })),
    { slot: "s1", log },
  );
  return {
    world: { now: () => ({ day: 1, minute: 0 }) },
    query: () => ({}),
    timeline: { current: () => ({ name: "main" }) },
    scene: { start: async () => "s", end: async () => {}, turn: async function* () {}, active: () => null },
    mods: () => ({ mods: [], drift: false, provenance: {} }),
    on: () => () => {},
    modelCallLog: log,
    gallery: galleryStub(),
    info: () => ({
      root: "/tmp",
      language: "en",
      locale: "en",
      promptLocale: "en",
      outputLocale: "en",
      contentLocale: "en",
      branch: "main",
      sessionId: "t",
      models: { s1: port.id, s2: port.id },
      modelMode: "live",
    }),
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

describe("SessionRoom llm_log", () => {
  test("spectator may read log after hello", async () => {
    const engine = engineWithLog();
    const host = new SessionHost({ engine });
    const room = new SessionRoom("sess", host, {
      host: "127.0.0.1",
      maxMessagesPerMinute: 1000,
      maxMessageBytes: 1_000_000,
      allowedOrigins: [],
    });
    const ws = fakeWs("ws-a", "client-a");
    room.registerClient(ws as never, ws.data.id);
    await room.handleMessage(ws as never, JSON.stringify({ v: 1, type: "hello", clientId: "client-a" }));
    await (engine as { modelCallLog: ReturnType<typeof createModelCallLog> }).modelCallLog;
    const inner = createScriptedModel("stub/m", () => ({ ok: true as const }));
    // trigger a logged call via wrapped port on engine - use direct list append via port on models - skip, pre-seed via object on models not exposed
    // Instead call host engine's model through scripted - engine only exposes log
    const log = engine.modelCallLog!;
    const schema = z.object({ text: z.string() });
    const p = withModelCallLog(createScriptedModel("x", () => ({ text: "hi" })), { slot: "s1", log });
    await p.object({
      label: "render",
      segments: { static: "s", semiStatic: "", dynamic: "", user: "u" },
      maxOutputTokens: 8,
      schema,
    });

    await room.handleMessage(
      ws as never,
      JSON.stringify({ v: 1, type: "llm_log", id: "r1", limit: 10 }),
    );
    const result = ws.sent.find((m) => (m as { type?: string }).type === "result") as {
      data?: { entries?: { label: string }[] };
    };
    expect(result?.data?.entries?.[0]?.label).toBe("render");
  });
});
