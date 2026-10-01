import { expect, test } from "bun:test";
import { ClientMessageSchema, ConfigSetResultSchema, ServerMessageSchema } from "../src/protocol/schemas.ts";

test("config_set result meta round-trip", () => {
  const meta = { restarting: true, message: "Session restart scheduled." };
  expect(ConfigSetResultSchema.parse(meta)).toEqual(meta);
});

test("client hello round-trip", () => {
  const msg = { v: 1 as const, type: "hello" as const, role: "controller" as const, resumeSeq: 0 };
  expect(ClientMessageSchema.parse(msg)).toEqual(msg);
});

test("server snapshot round-trip", () => {
  const msg = {
    v: 1 as const,
    type: "snapshot" as const,
    seq: 1,
    state: { scene: { active: true } },
  };
  expect(ServerMessageSchema.parse(msg)).toEqual(msg);
});

test("stream message shape", () => {
  const msg = {
    v: 1 as const,
    type: "stream" as const,
    seq: 2,
    requestId: "r1",
    phase: "delta" as const,
    segment: "dialogue" as const,
    text: "Hello",
  };
  const parsed = ServerMessageSchema.parse(msg);
  expect(parsed.type === "stream" ? parsed.text : "").toBe("Hello");
});
