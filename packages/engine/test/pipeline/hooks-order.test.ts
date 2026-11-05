import { describe, expect, test } from "bun:test";
import { HookRegistry } from "../../src/pipeline/hooks.ts";
import { createFakeKernel } from "../support/kernel-fake.ts";
import { testTurnCtx } from "../helpers/turn-context.ts";

describe("HookRegistry", () => {
  test("has reports registration; hooks run outermost first", async () => {
    const hooks = new HookRegistry();
    expect(hooks.has("appraise")).toBe(false);
    const order: string[] = [];
    hooks.register("appraise", async (_t, next, _k) => {
      order.push("outer");
      return next();
    });
    hooks.register("appraise", async (_t, next, _k) => {
      order.push("inner");
      return next();
    });
    expect(hooks.has("appraise")).toBe(true);
    const { k } = createFakeKernel();
    const turn = testTurnCtx({ text: "hi" });
    const result = await hooks.run("appraise", k, turn, async () => {
      order.push("default");
      return 42;
    });
    expect(result).toBe(42);
    expect(order).toEqual(["outer", "inner", "default"]);
  });
});
