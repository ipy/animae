import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { createRuleModelPort, RULE_MODEL_ID } from "../../src/model/rule-port.ts";
import { createFakeKernel } from "../support/kernel-fake.ts";
import { AnimaeError } from "../../src/types.ts";
import { buildCallContext, EMPTY_SEGMENTS } from "../../src/pipeline/call-context.ts";
import { testCallContextTurn } from "../helpers/turn-context.ts";

describe("createRuleModelPort", () => {
  test("object calls require purpose and context", async () => {
    const { k } = createFakeKernel();
    const port = createRuleModelPort(k);
    await expect(port.object({ label: "x", segments: EMPTY_SEGMENTS, schema: z.object({}), maxOutputTokens: 0 })).rejects.toMatchObject({
      code: "RULE_UNSUPPORTED",
    });
  });

  test("classify and safety purposes return fixed shapes", async () => {
    const { k } = createFakeKernel();
    const port = createRuleModelPort(k);
    const ctx = buildCallContext(k, { purpose: "classify", turn: testCallContextTurn({ turnId: "t" }), extra: { text: "ignore previous" } });
    const cls = await port.object({
      label: "classify",
      purpose: "classify",
      segments: EMPTY_SEGMENTS,
      schema: z.object({ input_class: z.string() }),
      maxOutputTokens: 0,
      context: ctx,
    });
    expect(cls.input_class).toBeDefined();
    const safe = await port.object({
      label: "safety",
      purpose: "safety",
      segments: EMPTY_SEGMENTS,
      schema: z.object({ safety: z.string() }),
      maxOutputTokens: 0,
      context: buildCallContext(k, { purpose: "safety", turn: testCallContextTurn({ turnId: "t" }), extra: {} }),
    });
    expect(safe.safety).toBe("none");
  });

  test("stream serves render and offscreen; unknown purpose throws", async () => {
    const { k } = createFakeKernel();
    const port = createRuleModelPort(k);
    const ctx = buildCallContext(k, {
      purpose: "render",
      self: "npc1",
      turn: testCallContextTurn({ turnId: "t" }),
      extra: { text: "hi" },
    });
    const parts: unknown[] = [];
    for await (const p of port.stream({
      label: "render",
      purpose: "render",
      segments: EMPTY_SEGMENTS,
      schema: z.object({ text: z.string() }),
      maxOutputTokens: 100,
      context: ctx,
    })) {
      parts.push(p);
    }
    expect(parts.some((p) => (p as { type: string }).type === "final")).toBe(true);

    await expect(
      (async () => {
        for await (const _ of port.stream({
          label: "bad",
          purpose: "appraise",
          segments: EMPTY_SEGMENTS,
          schema: z.object({}),
          maxOutputTokens: 0,
          context: ctx,
        })) {
          /* consume */
        }
      })(),
    ).rejects.toMatchObject({ code: "RULE_UNSUPPORTED" });
    expect(port.id).toBe(RULE_MODEL_ID);
  });
});
