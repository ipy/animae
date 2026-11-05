import { describe, expect, test } from "bun:test";
import { createRuleEnv } from "../../src/rule-backend/env.ts";
import { ruleEntity } from "../../src/rule-backend/entity.ts";
import { ruleOffscreen } from "../../src/rule-backend/offscreen.ts";
import { ruleReflection } from "../../src/rule-backend/reflection.ts";
import { createFakeKernel } from "../support/kernel-fake.ts";
import type { EntityCallExtra } from "../../src/rule-backend/entity.ts";
import type { ModelCallContext } from "../../src/ports.ts";
import { TemplateSchema } from "../../src/schema/authored.ts";

function entityCtx(extra: EntityCallExtra, rng = () => 0.42): ModelCallContext {
  return {
    rng,
    self: "npc1",
    other: "player",
    call: { outputLocale: "en" },
    extra: { template: extra.template, templateId: extra.templateId, hints: extra.hints, current: extra.current },
  };
}

function ctx(extra: Record<string, unknown>, rng = () => 0.42): ModelCallContext {
  return {
    rng,
    self: "npc1",
    other: "player",
    call: { outputLocale: "en" },
    extra,
  };
}

describe("rule-backend entity", () => {
  test("fills required fields from hints, defaults pool, and synthesis", () => {
    const { k } = createFakeKernel({
      policy: {
        reflection: { enabled: true, accept: "true" },
      },
    });
    const template = TemplateSchema.parse({
      fields: {
        name: { type: "string" },
        age: { type: "integer", min: 1, max: 10 },
        mood: { type: "string", enum: ["calm", "wild"] },
        note: { type: "string", optional: true },
      },
      defaults: { mood: ["calm", "wild"] },
    });
    const extra: EntityCallExtra = {
      template,
      templateId: "npc",
      hints: { name: "Hint Name" },
      current: { age: 7 },
    };
    const env = createRuleEnv(k, entityCtx(extra));
    const out = ruleEntity(env);
    expect(out.name).toBe("Hint Name");
    expect(out.age).toBe(7);
    const mood = out.mood;
    expect(mood === "calm" || mood === "wild").toBe(true);
    expect(out.note).toBeUndefined();
  });

  test("uses descriptor default and synthesizes when no candidate validates", () => {
    const { k } = createFakeKernel();
    const template = TemplateSchema.parse({
      fields: {
        score: { type: "number", default: 3.5, min: 0, max: 10 },
        label: { type: "string" },
      },
      defaults: {},
    });
    const env = createRuleEnv(
      k,
      ctx({
        template,
        templateId: "item",
        hints: { score: "not-a-number" },
      }),
    );
    const out = ruleEntity(env);
    expect(out.score).toBe(3.5);
    expect(String(out.label)).toMatch(/^item /);
  });
});

describe("rule-backend offscreen and reflection", () => {
  test("offscreen renders narrateTemplate or empty string", () => {
    const { k } = createFakeKernel({
      policy: {
        offscreen: {
          fidelity: { default: "rule", locations: {}, characters: {} },
          narrateTemplate: "Wind at {{ location.name }}.",
        },
      },
    });
    const env = createRuleEnv(k, ctx({ location: { name: "Harbor" } }));
    expect(ruleOffscreen(env).text).toBe("Wind at Harbor.");
    const { k: bare } = createFakeKernel();
    expect(ruleOffscreen(createRuleEnv(bare, ctx({}))).text).toBe("");
  });

  test("reflection summary template or empty summaries", () => {
    const { k } = createFakeKernel({
      policy: {
        reflection: { enabled: true, accept: "true", summaryTemplate: "Day {{ time.day }} summary." },
      },
    });
    const env = createRuleEnv(k, ctx({ time: { day: 2, minute: 0 } }));
    expect(ruleReflection(env)).toEqual({ summaries: ["Day 2 summary."], goal_changes: [], new_claims: [] });
    const { k: bare } = createFakeKernel({ policy: { reflection: { enabled: true, accept: "true" } } });
    expect(ruleReflection(createRuleEnv(bare, ctx({})))).toEqual({ summaries: [], goal_changes: [], new_claims: [] });
  });
});
