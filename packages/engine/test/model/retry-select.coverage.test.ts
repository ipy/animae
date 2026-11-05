import { describe, expect, test } from "bun:test";
import { APICallError } from "ai";
import { AnimaeError } from "../../src/types.ts";
import {
  isOutputValidationError,
  isTimeoutLikeError,
  isTransientError,
  withTransientRetries,
  MAX_TIMEOUT_RETRIES,
} from "../../src/model/retry.ts";
import {
  appraiseBindingFor,
  currentMode,
  FULL_MODE,
  renderBindingFor,
  ruleModelOf,
  s1PortFor,
  s1SpecOf,
  s2PortFor,
  s2SpecOf,
  tiersOf,
} from "../../src/model/select.ts";
import { createRuleModelPort } from "../../src/model/rule-port.ts";
import { createTierResolver } from "../../src/model/tier-resolver.ts";
import type { Kernel } from "../../src/contracts.ts";

describe("retry classification", () => {
  test("isTimeoutLikeError recognizes classified and AbortError messages", () => {
    expect(isTimeoutLikeError(new AnimaeError("MODEL_TIMEOUT", "slow"))).toBe(true);
    const err = new Error("first chunk timeout");
    err.name = "AbortError";
    expect(isTimeoutLikeError(err)).toBe(true);
  });

  test("isTransientError respects HTTP status and fetch TypeError", () => {
    expect(isTransientError(new AnimaeError("MODEL_HTTP", "x", undefined, { params: { status: 503 } }))).toBe(true);
    expect(isTransientError(new AnimaeError("MODEL_HTTP", "x", undefined, { params: { status: 404 } }))).toBe(false);
    expect(isTransientError(new TypeError("fetch failed"))).toBe(true);
    expect(
      isTransientError(
        new APICallError({
          message: "rate limit",
          url: "http://x",
          requestBodyValues: {},
          statusCode: 429,
          responseHeaders: {},
          responseBody: "",
          isRetryable: true,
        }),
      ),
    ).toBe(true);
  });

  test("isOutputValidationError detects ai validation errors", () => {
    expect(isOutputValidationError(new Error("plain"))).toBe(false);
  });

  test("withTransientRetries caps timeout retries", async () => {
    let calls = 0;
    const sleep = async () => {
      /* no wall clock */
    };
    await expect(
      withTransientRetries(
        async () => {
          calls += 1;
          throw new AnimaeError("MODEL_TIMEOUT", "t");
        },
        { max: 5, sleep },
      ),
    ).rejects.toMatchObject({ code: "MODEL_TIMEOUT" });
    expect(calls).toBe(MAX_TIMEOUT_RETRIES + 1);
  });
});

describe("model select helpers", () => {
  function miniKernel(over: Partial<Kernel> = {}): Kernel {
    const rule = createRuleModelPort({} as Kernel);
    const s1 = {
      id: "s1/model",
      object: async () => ({}),
      stream: async function* () {},
    } as import("../../src/ports.ts").ModelPort;
    const s2 = {
      id: "s2/model",
      object: async () => ({}),
      stream: async function* () {},
    } as import("../../src/ports.ts").ModelPort;
    return {
      authored: {
        config: {
          models: {
            s1: { provider: "openai", model: "gpt" },
            s2: { tiers: [{ id: "fast", provider: "openai", model: "mini" }], default: "fast" },
          },
        },
      },
      models: {
        s1,
        s2,
        rule,
        llm: { s1: true, s2: true },
        tiers: createTierResolver([{ id: "fast", port: s2 }], { default: "fast" }),
      },
      runtime: { mode: () => ({ appraise: "llm", render: "llm" }) },
      ...over,
    } as Kernel;
  }

  test("FULL_MODE and currentMode fallback", () => {
    expect(FULL_MODE).toEqual({ appraise: "llm", render: "llm" });
    expect(currentMode(miniKernel({ runtime: undefined }))).toEqual(FULL_MODE);
  });

  test("ports and bindings choose llm vs rule", () => {
    const k = miniKernel();
    expect(appraiseBindingFor(k, "llm")).toMatchObject({ backend: "llm", slot: "s1" });
    expect(appraiseBindingFor(k, "rule")).toEqual({ backend: "rule" });
    expect(s1PortFor(k, "llm").id).toBe("s1/model");
    expect(s1PortFor(k, "rule")).toBe(ruleModelOf(k));
    const binding = renderBindingFor(k, "fast");
    expect(binding).toMatchObject({ backend: "llm", tier: "fast" });
    expect(s2PortFor(k, binding).id).toBe("s2/model");
    expect(renderBindingFor(k, undefined)).toEqual({ backend: "rule" });
    expect(s1SpecOf(k)?.model).toBe("gpt");
    expect(s2SpecOf(k, "fast")?.model).toBe("mini");
    expect(tiersOf(k).get("fast")?.id).toBe("fast");
  });
});
