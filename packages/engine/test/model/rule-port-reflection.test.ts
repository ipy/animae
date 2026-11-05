import { test, expect } from "bun:test";
import { z } from "zod";
import { createRuleModelPort } from "../../src/model/rule-port.ts";
import { createFakeKernel } from "../support/kernel-fake.ts";
import { buildCallContext, EMPTY_SEGMENTS } from "../../src/pipeline/call-context.ts";
import { testCallContextTurn } from "../helpers/turn-context.ts";

test("rule port reflection purpose returns schema-shaped output", async () => {
  const { k } = createFakeKernel();
  const port = createRuleModelPort(k);
  const ctx = buildCallContext(k, {
    purpose: "reflection",
    self: "npc1",
    turn: testCallContextTurn({ turnId: "t" }),
    extra: { text: "day" },
  });
  const out = await port.object({
    label: "reflection",
    purpose: "reflection",
    segments: EMPTY_SEGMENTS,
    schema: z.object({ summaries: z.array(z.string()) }).passthrough(),
    maxOutputTokens: 0,
    context: ctx,
  });
  expect(Array.isArray(out.summaries)).toBe(true);
});
