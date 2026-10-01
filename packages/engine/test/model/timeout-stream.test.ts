import { describe, expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModelV4StreamPart, LanguageModelV4Usage } from "@ai-sdk/provider";
import { z } from "zod";
import { createModelPort } from "../../src/model/index.ts";
import { AnimaeError } from "../../src/types.ts";

const usageV4 = (): LanguageModelV4Usage => ({
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
});

describe("streaming with mock model", () => {
  test("steady partial output completes even when spread over longer wall time than timeoutMs", async () => {
    const mock = new MockLanguageModelV4({
      doStream: async () => ({
        stream: new ReadableStream<LanguageModelV4StreamPart>({
          async start(controller) {
            const id = "txt-1";
            controller.enqueue({ type: "text-start", id });
            // The SDK holds text deltas back until a partial object can be parsed, so emit the JSON
            // prefix as one delta and then trickle the value: gaps between deltas stay ~100ms.
            controller.enqueue({ type: "text-delta", id, delta: '{"text":"' });
            for (const ch of "hello-stream") {
              await new Promise((r) => setTimeout(r, 100));
              controller.enqueue({ type: "text-delta", id, delta: ch });
            }
            controller.enqueue({ type: "text-delta", id, delta: '"}' });
            controller.enqueue({ type: "text-end", id });
            controller.enqueue({
              type: "finish",
              finishReason: { unified: "stop", raw: undefined },
              usage: usageV4(),
            });
            controller.close();
          },
        }),
      }),
    });

    const port = createModelPort(
      { provider: "openai", model: "mock", timeoutMs: 700 },
      { model: mock, maxTransientRetries: 0 },
    );
    const schema = z.object({ text: z.string() });
    let text = "";
    for await (const part of port.stream({
      label: "steady",
      segments: { static: "s", semiStatic: "", dynamic: "", user: "u", history: [] },
      maxOutputTokens: 64,
      schema,
    })) {
      if (part.type === "final") text = String((part.value as { text?: string }).text ?? "");
    }
    expect(text).toBe("hello-stream");
  }, 15_000);
});


const streamReq = {
  label: "stall",
  segments: { static: "s", semiStatic: "", dynamic: "", user: "u", history: [] },
  maxOutputTokens: 64,
  schema: z.object({ text: z.string() }),
};

async function drain(port: ReturnType<typeof createModelPort>): Promise<unknown> {
  try {
    for await (const _ of port.stream(streamReq)) {
      /* drain */
    }
    return undefined;
  } catch (e) {
    return e;
  }
}

describe("streaming against a real HTTP server", () => {
  test("a server that accepts the request but never answers times out as first_chunk", async () => {
    let requests = 0;
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => {
        requests += 1;
        return new Promise<Response>(() => {});
      },
    });
    try {
      const port = createModelPort(
        { provider: "openai-compatible", model: "m", baseURL: `http://127.0.0.1:${server.port}/v1`, apiKey: "x", timeoutMs: 250 },
        { maxTransientRetries: 0 },
      );
      const t0 = Date.now();
      const err = await drain(port);
      expect(err).toBeInstanceOf(AnimaeError);
      expect((err as AnimaeError).code).toBe("MODEL_TIMEOUT");
      expect((err as AnimaeError).params).toMatchObject({ timeoutMs: 250, phase: "first_chunk" });
      expect(Date.now() - t0).toBeLessThan(3_000);
      expect(requests).toBe(1);
    } finally {
      server.stop(true);
    }
  }, 15_000);

  test("a stream that goes silent after some output times out as idle", async () => {
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch() {
        const enc = new TextEncoder();
        const body = new ReadableStream({
          start(c) {
            const chunk = { id: "1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: '{"text":"hel' } }] };
            c.enqueue(enc.encode(`data: ${JSON.stringify(chunk)}\n\n`));
          },
        });
        return new Response(body, { headers: { "content-type": "text/event-stream" } });
      },
    });
    try {
      const port = createModelPort(
        { provider: "openai-compatible", model: "m", baseURL: `http://127.0.0.1:${server.port}/v1`, apiKey: "x", timeoutMs: 250 },
        { maxTransientRetries: 0 },
      );
      const err = await drain(port);
      expect(err).toBeInstanceOf(AnimaeError);
      expect((err as AnimaeError).code).toBe("MODEL_TIMEOUT");
      expect((err as AnimaeError).params).toMatchObject({ phase: "idle" });
    } finally {
      server.stop(true);
    }
  }, 15_000);

  test("a timed-out stream is retried at most once even when more transient retries are allowed", async () => {
    let requests = 0;
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => {
        requests += 1;
        return new Promise<Response>(() => {});
      },
    });
    try {
      const port = createModelPort(
        { provider: "openai-compatible", model: "m", baseURL: `http://127.0.0.1:${server.port}/v1`, apiKey: "x", timeoutMs: 200 },
        { maxTransientRetries: 3, sleep: async () => {} },
      );
      const err = await drain(port);
      expect((err as AnimaeError).code).toBe("MODEL_TIMEOUT");
      expect(requests).toBe(2);
    } finally {
      server.stop(true);
    }
  }, 15_000);

  test("HTTP errors on the stream path are classified with their status and not retried when permanent", async () => {
    let requests = 0;
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => {
        requests += 1;
        return new Response(JSON.stringify({ error: { message: "Incorrect API key provided" } }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      },
    });
    try {
      const port = createModelPort(
        { provider: "openai-compatible", model: "m", baseURL: `http://127.0.0.1:${server.port}/v1`, apiKey: "x", timeoutMs: 5_000 },
        { maxTransientRetries: 3, sleep: async () => {} },
      );
      const err = await drain(port);
      expect(err).toBeInstanceOf(AnimaeError);
      expect((err as AnimaeError).code).toBe("MODEL_HTTP");
      expect((err as AnimaeError).params).toMatchObject({ status: 401 });
      expect(String((err as AnimaeError).params?.detail)).toContain("Incorrect API key");
      expect(requests).toBe(1);
    } finally {
      server.stop(true);
    }
  }, 15_000);

  test("a 503 on the stream path is retried and then reported as MODEL_HTTP", async () => {
    let requests = 0;
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => {
        requests += 1;
        return new Response("overloaded", { status: 503 });
      },
    });
    try {
      const port = createModelPort(
        { provider: "openai-compatible", model: "m", baseURL: `http://127.0.0.1:${server.port}/v1`, apiKey: "x", timeoutMs: 5_000 },
        { maxTransientRetries: 2, sleep: async () => {} },
      );
      const err = await drain(port);
      expect((err as AnimaeError).code).toBe("MODEL_HTTP");
      expect((err as AnimaeError).params).toMatchObject({ status: 503 });
      expect(requests).toBe(3);
    } finally {
      server.stop(true);
    }
  }, 15_000);

  test("a closed port is reported as unreachable, not as a timeout", async () => {
    const probe = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") });
    const freePort = probe.port;
    probe.stop(true);
    const port = createModelPort(
      { provider: "openai-compatible", model: "m", baseURL: `http://127.0.0.1:${freePort}/v1`, apiKey: "x", timeoutMs: 5_000 },
      { maxTransientRetries: 0 },
    );
    const err = await drain(port);
    expect(err).toBeInstanceOf(AnimaeError);
    expect((err as AnimaeError).code).toBe("MODEL_UNREACHABLE");
  }, 15_000);
});
