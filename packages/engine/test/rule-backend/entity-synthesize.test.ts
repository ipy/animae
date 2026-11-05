import { describe, expect, test } from "bun:test";
import { createRuleEnv } from "../../src/rule-backend/env.ts";
import { ruleEntity } from "../../src/rule-backend/entity.ts";
import { createFakeKernel } from "../support/kernel-fake.ts";
import type { ModelCallContext } from "../../src/ports.ts";
import { TemplateSchema } from "../../src/schema/authored.ts";

function ctx(extra: Record<string, unknown>, rng = () => 0.25): ModelCallContext {
  return { rng, self: "npc", other: "player", call: { outputLocale: "en" }, extra };
}

describe("ruleEntity synthesis paths", () => {
  test("synthesizes object, array, boolean, and enum number fields", () => {
    const { k } = createFakeKernel();
    const template = TemplateSchema.parse({
      fields: {
        meta: {
          type: "object",
          fields: {
            flag: { type: "boolean" },
            tag: { type: "string", optional: true },
          },
        },
        tags: { type: "array", items: { type: "string" } },
        tier: { type: "number", enum: [1, 2, 3] },
        onlyMax: { type: "integer", max: 5 },
        onlyMin: { type: "number", min: 10 },
      },
      defaults: {},
    });
    const out = ruleEntity(createRuleEnv(k, ctx({ template, templateId: "gen" })));
    expect(out.meta).toEqual({ flag: false });
    expect(out.tags).toEqual([]);
    const tier = out.tier;
    expect(tier === 1 || tier === 2 || tier === 3).toBe(true);
    expect(out.onlyMax).toBeGreaterThanOrEqual(0);
    expect(out.onlyMax).toBeLessThanOrEqual(5);
    expect(out.onlyMin).toBe(10);
  });

  test("picks from defaults pool for scalar fields", () => {
    const { k } = createFakeKernel();
    const template = TemplateSchema.parse({
      fields: { color: { type: "string", enum: ["red", "blue"] } },
      defaults: { color: ["red", "blue"] },
    });
    const env = createRuleEnv(k, ctx({ template, templateId: "c" }, () => 0.99));
    const color = ruleEntity(env).color;
    expect(color === "red" || color === "blue").toBe(true);
  });
});
