import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { createModelPort, createStreamWatchdog, resolveModelTimeoutMs } from "../../src/model/index.ts";
import { AnimaeError } from "../../src/types.ts";

describe("resolveModelTimeoutMs", () => {
  test("defaults by provider", () => {
    expect(resolveModelTimeoutMs({ provider: "openai", model: "x" })).toBe(120_000);
    expect(resolveModelTimeoutMs({ provider: "ollama", model: "x" })).toBe(600_000);
  });

  test("respects configured timeoutMs with cap", () => {
    expect(resolveModelTimeoutMs({ provider: "openai", model: "x", timeoutMs: 30_000 })).toBe(30_000);
    expect(resolveModelTimeoutMs({ provider: "openai", model: "x", timeoutMs: 9_999_999 })).toBe(3_600_000);
  });
});

describe("createStreamWatchdog", () => {
  test("fires as first_chunk when no output arrives, aborting the signal", async () => {
    let fired = 0;
    const w = createStreamWatchdog(40, () => (fired += 1));
    await new Promise((r) => setTimeout(r, 120));
    expect(w.firedPhase).toBe("first_chunk");
    expect(w.signal.aborted).toBe(true);
    expect(fired).toBe(1);
    w.stop();
  });

  test("touch keeps a steady stream alive and later silence is reported as idle", async () => {
    const w = createStreamWatchdog(80);
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 40));
      w.touch();
    }
    expect(w.firedPhase).toBeUndefined();
    await new Promise((r) => setTimeout(r, 160));
    expect(w.firedPhase).toBe("idle");
    expect(w.signal.aborted).toBe(true);
    w.stop();
  });

  test("stop cancels the timer", async () => {
    const w = createStreamWatchdog(30);
    w.stop();
    await new Promise((r) => setTimeout(r, 90));
    expect(w.firedPhase).toBeUndefined();
    expect(w.signal.aborted).toBe(false);
  });
});

describe("abortSignal from AI SDK", () => {
  test("object call aborts when doGenerate ignores abortSignal until too late", async () => {
    const schema = z.object({ ok: z.literal(true) });
    const req = {
      label: "abort",
      segments: { static: "json", semiStatic: "", dynamic: "", user: "ping", history: [] },
      maxOutputTokens: 16,
      schema,
    };
    const { MockLanguageModelV4 } = await import("ai/test");
    const mock = new MockLanguageModelV4({
      doGenerate: async (options) => {
        const signal = options.abortSignal;
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, 5_000);
          signal?.addEventListener(
            "abort",
            () => {
              clearTimeout(t);
              reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
            },
            { once: true },
          );
        });
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true }) }],
          finishReason: { unified: "stop", raw: undefined },
          usage: {
            inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 1, text: 1, reasoning: 0 },
          },
          warnings: [],
        };
      },
    });
    const port = createModelPort(
      { provider: "openai", model: "mock", timeoutMs: 120 },
      { model: mock, maxTransientRetries: 0 },
    );
    const err = await port.object(req).catch((e) => e);
    expect(err).toBeInstanceOf(AnimaeError);
    expect((err as AnimaeError).code).toBe("MODEL_TIMEOUT");
  }, 10_000);
});
