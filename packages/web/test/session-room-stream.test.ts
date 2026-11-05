import { describe, expect, test } from "bun:test";
import { SessionHost } from "@animae/host";
import type { Engine, TurnChunk } from "@animae/engine";
import { ServerStreamSchema } from "../src/protocol/schemas.ts";
import { SessionRoom } from "../src/server/session-room.ts";
import { baseStubEngine } from "./helpers/stub-engine.ts";

type FakeWs = {
  data: { id: string; clientId: string; role: "controller" | "spectator"; authenticated: boolean; messageTimes: number[]; locale: string };
  send: (s: string) => void;
  sent: Record<string, unknown>[];
};

function fakeWs(): FakeWs {
  const sent: Record<string, unknown>[] = [];
  return {
    data: { id: "ws-a", clientId: "client-a", role: "spectator", authenticated: false, messageTimes: [], locale: "en" },
    sent,
    send(s: string) {
      sent.push(JSON.parse(s) as Record<string, unknown>);
    },
  };
}

const security = { host: "127.0.0.1", maxMessagesPerMinute: 1000, maxMessageBytes: 1_000_000, allowedOrigins: [] };

/** A room whose engine plays `chunks` for the next turn; returns what a connected controller received. */
async function playTurn(chunks: TurnChunk[]): Promise<{ stream: Record<string, unknown>[]; host: SessionHost }> {
  const engine = baseStubEngine();
  (engine.scene as { turn: Engine["scene"]["turn"] }).turn = async function* () {
    for (const c of chunks) yield c;
  };
  const host = new SessionHost({ engine });
  host.attachScene("scn_1");
  const room = new SessionRoom("sess", host, security);
  const ws = fakeWs();
  room.registerClient(ws as never, ws.data.id);
  await room.handleMessage(ws as never, JSON.stringify({ v: 1, type: "hello", role: "controller", clientId: "client-a" }));
  await room.handleMessage(ws as never, JSON.stringify({ v: 1, type: "input", id: "r1", text: "Hello" }));
  return { stream: ws.sent.filter((m) => m.type === "stream"), host };
}

const echo: TurnChunk = { type: "text", text: "Hello", speaker: "player", newUtterance: true };

describe("narration and reset on the wire", () => {
  test("a narration paragraph is streamed as its own segment with its style", async () => {
    const { stream, host } = await playTurn([
      echo,
      { type: "narration", text: "Rain ", style: "normal", newParagraph: true },
      { type: "narration", text: "falls.", style: "normal" },
      { type: "text", text: "Hi.", speaker: "npc", newUtterance: true },
      { type: "narration", text: "Later.", style: "scene_break", newParagraph: true },
      { type: "done", turnId: "turn_1", events: [] },
    ]);
    for (const frame of stream) expect(ServerStreamSchema.safeParse(frame).success).toBe(true);
    const narration = stream.filter((m) => m.segment === "narration");
    expect(narration.map((m) => [m.phase, m.text ?? m.style ?? null])).toEqual([
      ["start", "normal"],
      ["delta", "Rain "],
      ["delta", "falls."],
      ["end", null],
      ["start", "scene_break"],
      ["delta", "Later."],
      ["end", null],
    ]);
    const rows = host.ui.transcript.map((e) => [e.kind, e.style ?? null, e.text]);
    expect(rows).toEqual([
      ["dialogue", null, "Hello"],
      ["narration", "normal", "Rain falls."],
      ["dialogue", null, "Hi."],
      ["narration", "scene_break", "Later."],
    ]);
  });

  test("reset voids what was streamed since the player's line and the replacement follows", async () => {
    const { stream, host } = await playTurn([
      echo,
      { type: "narration", text: "Rain falls.", newParagraph: true },
      { type: "text", text: "Half a sen", speaker: "npc", newUtterance: true },
      { type: "reset", reason: "fallback" },
      { type: "text", text: "Hello back.", speaker: "npc", newUtterance: true },
      { type: "done", turnId: "turn_1", events: [] },
    ]);
    for (const frame of stream) expect(ServerStreamSchema.safeParse(frame).success).toBe(true);
    const reset = stream.findIndex((m) => m.phase === "reset");
    expect(reset).toBeGreaterThan(0);
    expect(stream[reset]).toMatchObject({ reason: "fallback" });
    // no `end` is sent for the segments the reset voided
    const after = stream.slice(reset + 1).map((m) => [m.phase, m.segment]);
    expect(after).toEqual([["start", "dialogue"], ["delta", "dialogue"], ["end", "dialogue"]]);
    const rows = host.ui.transcript.map((e) => [e.kind, e.text]);
    expect(rows).toEqual([
      ["dialogue", "Hello"],
      ["dialogue", "Hello back."],
    ]);
  });
});
