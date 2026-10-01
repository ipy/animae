import { describe, expect, test } from "bun:test";
import { ClientMessageSchema, ServerMessageSchema } from "../src/protocol/schemas.ts";
import { WEB_PROTOCOL_VERSION } from "../src/protocol/version.ts";

describe("gallery protocol schemas", () => {
  test("gallery messages are additive and keep protocol version 1", () => {
    expect(WEB_PROTOCOL_VERSION).toBe(1);
  });

  test("accepts gallery_list client message", () => {
    const parsed = ClientMessageSchema.safeParse({
      v: 1,
      type: "gallery_list",
      id: "r1",
      includeLocked: true,
    });
    expect(parsed.success).toBe(true);
  });

  test("rejects gallery_capture without id", () => {
    const parsed = ClientMessageSchema.safeParse({ v: 1, type: "gallery_capture" });
    expect(parsed.success).toBe(false);
  });

  test("gallery_list result data may include generatorAvailable", () => {
    const parsed = ServerMessageSchema.safeParse({
      v: 1,
      type: "result",
      seq: 1,
      id: "r1",
      ok: true,
      data: { gallery: [], generatorAvailable: false },
    });
    expect(parsed.success).toBe(true);
  });

  test("gallery_notice server shape", () => {
    const parsed = ServerMessageSchema.safeParse({
      v: 1,
      type: "gallery_notice",
      seq: 1,
      notice: { type: "unlocked", item: "preset-1" },
    });
    expect(parsed.success).toBe(true);
  });
});
