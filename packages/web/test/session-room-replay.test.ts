import { describe, expect, test } from "bun:test";
import { SessionHost } from "@animae/host";
import { SessionRoom } from "../src/server/session-room.ts";
import { baseStubEngine } from "./helpers/stub-engine.ts";

type FakeWs = {
  data: { id: string; clientId: string; role: "controller" | "spectator"; authenticated: boolean; messageTimes: number[]; locale: string };
  send: (s: string) => void;
  sent: Record<string, unknown>[];
};

function fakeWs(id: string): FakeWs {
  const sent: Record<string, unknown>[] = [];
  return {
    data: { id, clientId: `client-${id}`, role: "spectator", authenticated: false, messageTimes: [], locale: "en" },
    sent,
    send(s: string) {
      sent.push(JSON.parse(s) as Record<string, unknown>);
    },
  };
}

const security = { host: "127.0.0.1", maxMessagesPerMinute: 1000, maxMessageBytes: 1_000_000, allowedOrigins: [] };

async function connect(room: SessionRoom, ws: FakeWs, hello: Record<string, unknown>): Promise<void> {
  room.registerClient(ws as never, ws.data.id);
  await room.handleMessage(ws as never, JSON.stringify({ v: 1, type: "hello", role: "spectator", clientId: ws.data.clientId, ...hello }));
}

const busy = (seq: number, active: boolean, requestId: string) => ({ v: 1, type: "busy", seq, active, requestId }) as never;
const stream = (seq: number, phase: "start" | "delta" | "end", requestId: string) =>
  ({ v: 1, type: "stream", seq, requestId, phase, segment: "dialogue", ...(phase === "delta" ? { text: "x" } : {}) }) as never;

/** Streamed output of `done` finished turns, then (optionally) one that is still running. */
function roomWithTurns(done: number, running: boolean): SessionRoom {
  const room = new SessionRoom("sess", new SessionHost({ engine: baseStubEngine() }), security, {});
  let seq = 100;
  for (let i = 0; i < done; i++) {
    const id = `done-${i}`;
    room.broadcast(busy(seq++, true, id));
    room.broadcast(stream(seq++, "start", id));
    room.broadcast(stream(seq++, "delta", id));
    room.broadcast(stream(seq++, "end", id));
    room.broadcast(busy(seq++, false, id));
  }
  if (running) {
    room.broadcast(busy(seq++, true, "live"));
    room.broadcast(stream(seq++, "start", "live"));
    room.broadcast(stream(seq++, "delta", "live"));
  }
  return room;
}

const replayed = (ws: FakeWs) => ws.sent.filter((m) => m.type === "busy" || m.type === "stream");

describe("stream replay on connect", () => {
  test("a fresh client is not given the stream of turns that already finished", async () => {
    const room = roomWithTurns(5, false);
    const ws = fakeWs("fresh");
    await connect(room, ws, { resumeSeq: 0 });
    expect(replayed(ws)).toEqual([]);
    // It still gets the whole state.
    expect(ws.sent.some((m) => m.type === "snapshot")).toBe(true);
  });

  test("a fresh client that joins mid-turn follows that turn from its start, and nothing older", async () => {
    const room = roomWithTurns(3, true);
    const ws = fakeWs("joiner");
    await connect(room, ws, { resumeSeq: 0 });
    const got = replayed(ws);
    expect(got.map((m) => m.requestId)).toEqual(["live", "live", "live"]);
    expect(got.map((m) => m.type)).toEqual(["busy", "stream", "stream"]);
    expect(got[0]).toMatchObject({ active: true });
  });

  test("a client that omits resumeSeq gets no replay either", async () => {
    const room = roomWithTurns(2, true);
    const ws = fakeWs("plain");
    await connect(room, ws, {});
    expect(replayed(ws)).toEqual([]);
  });

  test("a returning client gets exactly what it missed", async () => {
    const room = roomWithTurns(2, true);
    const ws = fakeWs("back");
    await connect(room, ws, { resumeSeq: 108 });
    const seqs = replayed(ws).map((m) => m.seq);
    // Seen up to the end of the second finished turn's text: its closing busy report and the running turn follow.
    expect(seqs).toEqual([109, 110, 111, 112]);
  });

  test("a returning client that is up to date gets nothing", async () => {
    const room = roomWithTurns(1, true);
    const ws = fakeWs("current");
    await connect(room, ws, { resumeSeq: 107 });
    expect(replayed(ws)).toEqual([]);
  });
});
