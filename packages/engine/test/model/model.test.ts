import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModelV4Usage } from "@ai-sdk/provider";
import {
  anthropicCacheBreakpoints,
  createModelPort,
  createModelsFromConfig,
  createScriptedModel,
  recordingKey,
  resolveApiKey,
  segmentsToMessages,
  streamFromObject,
  withRecording,
} from "../../src/model/index.ts";
import { AnimaeError } from "../../src/types.ts";
import type { RecordingStore } from "../../src/contracts.ts";
import type { StreamPart } from "../../src/ports.ts";
import { isTransientError, withTransientRetries } from "../../src/model/retry.ts";

const usageV4 = (): LanguageModelV4Usage => ({
  inputTokens: { total: 12, noCache: 10, cacheRead: 2, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
});

const finish = (unified: "stop" | "tool-calls") => ({ unified, raw: undefined });

const renderSchema = z.object({ text: z.string() });

function baseReq() {
  return {
    label: "render",
    segments: {
      static: "world rules",
      semiStatic: "relations",
      dynamic: "context",
      user: "hello",
      history: [{ role: "user" as const, content: "prior" }, { role: "assistant" as const, content: "hi" }],
    },
    maxOutputTokens: 256,
    schema: renderSchema,
  };
}

describe("segments & cache", () => {
  test("maps segment order and anthropic cache breakpoints", () => {
    const msgs = segmentsToMessages(baseReq().segments, { provider: "anthropic" });
    expect(msgs[0]?.role).toBe("system");
    expect(msgs[1]?.role).toBe("system");
    expect(msgs[2]?.role).toBe("system");
    expect(msgs.at(-1)).toEqual({ role: "user", content: "hello" });
    expect(anthropicCacheBreakpoints(msgs)).toBe(2);
    const openaiMsgs = segmentsToMessages(baseReq().segments, { provider: "openai" });
    expect(anthropicCacheBreakpoints(openaiMsgs)).toBe(0);
  });
});

describe("resolveApiKey", () => {
  test("prefers spec.apiKey then env; missing returns undefined", () => {
    expect(resolveApiKey({ provider: "openai", model: "gpt", apiKey: "k" }, {})).toBe("k");
    expect(resolveApiKey({ provider: "openai", model: "gpt" }, { OPENAI_API_KEY: "env" })).toBe("env");
    expect(resolveApiKey({ provider: "openai", model: "gpt" }, {})).toBeUndefined();
    expect(resolveApiKey({ provider: "ollama", model: "llama" }, {})).toBeUndefined();
  });
});

describe("recording key stability", () => {
  test("stable for same inputs", () => {
    const req = baseReq();
    expect(recordingKey("anthropic/x", req)).toBe(recordingKey("anthropic/x", req));
    expect(recordingKey("anthropic/x", req)).not.toBe(recordingKey("anthropic/y", req));
  });
});

describe("ScriptedModel", () => {
  test("object and stream", async () => {
    const port = createScriptedModel("test/m", () => ({ text: "ok" }));
    const v = await port.object(baseReq());
    expect(v.text).toBe("ok");
    const parts: StreamPart[] = [];
    for await (const p of port.stream(baseReq())) parts.push(p);
    expect(parts.some((p) => p.type === "final")).toBe(true);
  });

  test("streamFromObject grows text field", async () => {
    const partials: { text: string }[] = [];
    for await (const p of streamFromObject({ text: "abcd" }, 2)) partials.push(p);
    expect(partials.at(-1)?.text).toBe(JSON.stringify({ text: "abcd" }));
  });
});

describe("withRecording", () => {
  test("record then replay stream identity", async () => {
    const inner = createScriptedModel("m/m", () => streamFromObject({ text: "x" }));
    const store: RecordingStore & { map: Map<string, unknown> } = {
      mode: "record",
      map: new Map(),
      lookup(key) {
        return this.map.get(key);
      },
      async record(key, response) {
        this.map.set(key, response);
      },
    };
    const wrapped = withRecording(inner, store);
    const live: StreamPart[] = [];
    for await (const p of wrapped.stream(baseReq())) live.push(p);

    store.mode = "replay";
    const replay: StreamPart[] = [];
    for await (const p of wrapped.stream(baseReq())) replay.push(p);
    expect(JSON.stringify(replay)).toBe(JSON.stringify(live));
  });

  test("replay miss throws RECORDING_MISSING", async () => {
    const inner = createScriptedModel("m/m", () => ({ text: "a" }));
    const store: RecordingStore = { mode: "replay", lookup: () => undefined, record: async () => {} };
    const wrapped = withRecording(inner, store);
    await expect(wrapped.object(baseReq())).rejects.toMatchObject({ code: "RECORDING_MISSING" });
  });
});

describe("createModelsFromConfig", () => {
  test("requires models", () => {
    expect(() => createModelsFromConfig({ seed: 0, policies: [] })).toThrow(AnimaeError);
    expect(() => createModelsFromConfig({ seed: 0, policies: [], models: { s1: { provider: "anthropic", model: "x" } } as never })).toThrow(
      AnimaeError,
    );
  });
});

describe("createModelPort with MockLanguageModelV4", () => {
  test("structured object via Output.object", async () => {
    const mock = new MockLanguageModelV4({
      doGenerate: {
        content: [{ type: "text", text: JSON.stringify({ text: "hello" }) }],
        finishReason: finish("stop"),
        usage: usageV4(),
        warnings: [],
      },
    });
    const port = createModelPort(
      { provider: "openai", model: "mock", apiKey: "x" },
      { model: mock, env: {} },
    );
    const out = await port.object(baseReq());
    expect(out.text).toBe("hello");
    expect(port.usage?.().inputTokens).toBe(12);
    expect(mock.doGenerateCalls.length).toBe(1);
    const msgs = mock.doGenerateCalls[0]?.prompt;
    expect(Array.isArray(msgs)).toBe(true);
  });

  test("tool execute runs on object multi-step", async () => {
    let toolRan = 0;
    const mock = new MockLanguageModelV4({
      doGenerate: [
        {
          content: [
            {
              type: "tool-call",
              toolCallId: "c1",
              toolName: "search",
              input: JSON.stringify({ q: "x" }),
            },
          ],
          finishReason: finish("tool-calls"),
          usage: usageV4(),
          warnings: [],
        },
        {
          content: [{ type: "text", text: JSON.stringify({ text: "done" }) }],
          finishReason: finish("stop"),
          usage: usageV4(),
          warnings: [],
        },
      ],
    });
    const port = createModelPort(
      { provider: "openai", model: "mock", apiKey: "x" },
      { model: mock, env: {} },
    );
    const req = {
      ...baseReq(),
      tools: [
        {
          name: "search",
          description: "search",
          input: z.object({ q: z.string() }),
          execute: () => {
            toolRan++;
            return { hits: [] };
          },
        },
      ],
      maxSteps: 2,
    };
    const out = await port.object(req);
    expect(out.text).toBe("done");
    expect(toolRan).toBe(1);
    expect(mock.doGenerateCalls.length).toBe(2);
  });
});

describe("retry", () => {
  test("transient backoff then success", async () => {
    const sleeps: number[] = [];
    let n = 0;
    const v = await withTransientRetries(
      async () => {
        n++;
        if (n < 3) throw new APICallError({ message: "rate", url: "u", requestBodyValues: {}, statusCode: 429, isRetryable: true });
        return 42;
      },
      { max: 3, sleep: async (ms) => { sleeps.push(ms); } },
    );
    expect(v).toBe(42);
    expect(sleeps).toEqual([200, 400]);
  });

  test("no retry on 400", async () => {
    let n = 0;
    await expect(
      withTransientRetries(async () => {
        n++;
        throw new APICallError({ message: "bad", url: "u", requestBodyValues: {}, statusCode: 400, isRetryable: false });
      }),
    ).rejects.toBeInstanceOf(APICallError);
    expect(n).toBe(1);
    expect(isTransientError(new APICallError({ message: "bad", url: "u", requestBodyValues: {}, statusCode: 400 }))).toBe(false);
  });
});
