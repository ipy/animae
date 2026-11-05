import { describe, expect, test } from "bun:test";
import { validateFieldL3Effects, validateL3EffectsOnly } from "../../src/fields/l3-validate.ts";
import { createFakeKernel } from "../support/kernel-fake.ts";
import { AnimaeError } from "../../src/types.ts";
import type { FieldDef } from "../../src/schema/authored.ts";
import { fieldEffectsWithRuleAdd } from "../helpers/field-effects.ts";
import { CustomRuleSchema } from "../../src/schema/custom-rule.ts";

describe("validateFieldL3Effects", () => {
  test("non-L3 fields are no-ops", () => {
    const { k } = createFakeKernel();
    expect(() => validateFieldL3Effects(k, { id: "f1", level: "L0", effects: {} } as FieldDef)).not.toThrow();
  });

  test("invalid rule_add and missing fn fail at grant time", () => {
    const { k } = createFakeKernel({
      policy: { rules: { custom: [{ id: "r1", stage: "adjudicate", fn: "knownRule" }] } },
    });
    k.rules.has = (name) => name === "knownRule";
    k.rules.register = () => {};
    expect(() =>
      validateL3EffectsOnly(k, { rule_add: [{ id: "bad", stage: "adjudicate", fn: "missing", when: "true" }] }, "test"),
    ).toThrow(AnimaeError);
    const malformedRule = { not: "a rule" };
    expect(CustomRuleSchema.safeParse(malformedRule).success).toBe(false);
    expect(() => validateL3EffectsOnly(k, fieldEffectsWithRuleAdd([malformedRule]), "test")).toThrow(/invalid rule_add/);
  });

  test("rule_override keys must reference policy or added ids", () => {
    const { k } = createFakeKernel({
      policy: { rules: { custom: [{ id: "base", stage: "adjudicate", fn: "knownRule" }] } },
    });
    k.rules.has = () => true;
    expect(() =>
      validateL3EffectsOnly(
        k,
        {
          rule_add: [{ id: "added", stage: "adjudicate", fn: "knownRule", when: "true" }],
          rule_override: { ghost: "added" },
        },
        "field x",
      ),
    ).toThrow(/rule_override key "ghost"/);
    expect(() =>
      validateL3EffectsOnly(
        k,
        {
          rule_add: [{ id: "added", stage: "adjudicate", fn: "knownRule", when: "true" }],
          rule_override: { base: "missing" },
        },
        "field x",
      ),
    ).toThrow(/target "missing"/);
  });
});
