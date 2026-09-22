import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  createModelCallLog,
  createScriptedModel,
  redactSecrets,
  withModelCallLog,
} from "../../src/model/index.ts";

const schema = z.object({ text: z.string() });

function baseReq(label = "render") {
  return {
    label,
    segments: {
      static: "rules",
      semiStatic: "rel",
      dynamic: "ctx",
      user: "hello",
      history: [{ role: "user" as const, content: "hi" }],
    },
    maxOutputTokens: 64,
    schema,
  };
}

describe("createModelCallLog", () => {
  test("evicts oldest when over capacity", async () => {
    const log = createModelCallLog({ capacity: 2 });
    const inner = createScriptedModel("test/m", (req) => ({ text: req.label }));
    const port = withModelCallLog(inner, { slot: "s1", log });
    await port.object({ ...baseReq("a") });
    await port.object({ ...baseReq("b") });
    await port.object({ ...baseReq("c") });
    const labels = log.list().map((e) => e.label);
    expect(labels).toContain("c");
    expect(labels).toContain("b");
    expect(labels).not.toContain("a");
  });

  test("records streaming calls with timing", async () => {
    const log = createModelCallLog();
    const inner = createScriptedModel("test/m", () => ({ text: "streamed" }));
    const port = withModelCallLog(inner, { slot: "s2", log });
    for await (const _ of port.stream(baseReq())) {
      /* drain */
    }
    const entry = log.list()[0];
    expect(entry?.slot).toBe("s2");
    expect(entry?.response?.raw).toContain("streamed");
    expect(entry?.timing.totalMs).toBeGreaterThanOrEqual(0);
    expect(entry?.timing.firstChunkMs).toBeDefined();
  });

  test("records aborted object calls", async () => {
    const log = createModelCallLog();
    const abortErr = new Error("The operation was aborted");
    abortErr.name = "AbortError";
    const inner = createScriptedModel("test/m", () => {
      throw abortErr;
    });
    const port = withModelCallLog(inner, { slot: "s1", log });
    await expect(port.object(baseReq())).rejects.toThrow();
    expect(log.list()[0]?.status).toBe("aborted");
  });

  test("records errors and redacts secrets", async () => {
    const log = createModelCallLog();
    const inner = createScriptedModel("test/m", () => {
      throw new Error("failed sk-abcdefghijklmnopqrstuvwxyz");
    });
    const port = withModelCallLog(inner, { slot: "s1", log });
    await expect(port.object(baseReq())).rejects.toThrow();
    const entry = log.list()[0];
    expect(entry?.status).toBe("error");
    expect(entry?.error?.message).toContain("[REDACTED]");
    expect(entry?.error?.message).not.toContain("sk-abc");
  });

  test("truncates huge prompt segments", async () => {
    const log = createModelCallLog({ maxCharsPerEntry: 200 });
    const inner = createScriptedModel("test/m", () => ({ text: "ok" }));
    const port = withModelCallLog(inner, { slot: "s1", log });
    await port.object({
      ...baseReq(),
      segments: { ...baseReq().segments, user: "x".repeat(500) },
    });
    const seg = log.list()[0]?.request.segments.find((s) => s.role === "user");
    expect(seg?.truncated).toBe(true);
  });

  test("interleaved concurrent calls keep order by seq", async () => {
    const log = createModelCallLog({ capacity: 10 });
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const inner = createScriptedModel("test/m", async (req) => {
      if (req.label === "slow") await gate;
      return { text: req.label };
    });
    const port = withModelCallLog(inner, { slot: "s1", log });
    const slow = port.object({ ...baseReq("slow") });
    const fast = port.object({ ...baseReq("fast") });
    await fast;
    release();
    await slow;
    const seqs = log.list().map((e) => e.seq).sort((a, b) => a - b);
    expect(seqs).toEqual([1, 2]);
  });

  test("forwards capability tags to CEL and hot-sync", () => {
    const log = createModelCallLog();
    const inner = createScriptedModel("test/tagged", () => ({ text: "ok" }), undefined, {
      tags: ["content:standard"],
    });
    const port = withModelCallLog(inner, { slot: "s1", log });
    expect(port.tags).toEqual(["content:standard"]);
    port.tags = ["content:mature"];
    expect(inner.tags).toEqual(["content:mature"]);
    expect(port.tags).toEqual(["content:mature"]);
  });
});

describe("redactSecrets", () => {
  test("strips bearer tokens", () => {
    expect(redactSecrets("Authorization: Bearer sk-1234567890abcd")).toContain("[REDACTED]");
  });
});
