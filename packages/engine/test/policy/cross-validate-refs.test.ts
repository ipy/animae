import { describe, expect, test } from "bun:test";
import { validatePolicyDocument } from "../../src/policy/validate.ts";

describe("validatePolicyDocument cross checks", () => {
  test("track tier duplicates and delta_table unknown refs", () => {
    const r = validatePolicyDocument({
      events: { types: { chat: {}, other: {} } },
      intent: { types: ["talk", "ghost"] },
      tracks: {
        mood: {
          scope: "self",
          min: 0,
          max: 100,
          initial: 50,
          tiers: [
            { name: "a", from: 10 },
            { name: "a", from: 20 },
          ],
          hysteresis: 0,
        },
      },
      rules: { delta_table: { chat: { missing_track: 1 } } },
      intent_rules: [{ intent: "ghost", when: "true", score: 1 }],
    });
    expect(r.issues.some((i) => i.path.includes("tiers") && i.message.includes("duplicate"))).toBe(true);
    expect(r.issues.some((i) => i.message.includes("missing_track"))).toBe(true);
  });

  test("custom rules warn when fn is not registered", () => {
    const r = validatePolicyDocument(
      {
        events: { types: { other: {} } },
        intent: { types: ["talk"] },
        rules: { custom: [{ id: "c1", stage: "adjudicate", fn: "fn1", when: "true" }] },
      },
      { knownRuleFns: new Set(["otherFn"]) },
    );
    expect(r.warnings.some((w) => w.path.includes("rules.custom") && w.message.includes("fn1"))).toBe(true);
  });

  test("input.response hook warns when rule fn is unknown", () => {
    const r = validatePolicyDocument(
      {
        events: { types: { other: {} } },
        intent: { types: ["talk", "deflect"] },
        input: {
          response: {
            injection_suspect: { intent: "deflect" },
            meta_probe: { hook: "missingHook" },
          },
        },
      },
      { knownRuleFns: new Set(["otherFn"]) },
    );
    expect(r.warnings.some((w) => w.path.includes("hook") && w.message.includes("missingHook"))).toBe(true);
  });

  test("field grant level and visibility empty paths", () => {
    const r = validatePolicyDocument({
      events: { types: { other: {} } },
      intent: { types: ["talk"] },
      fields: { grants: [{ holder: "true", source: "true", maxLevel: "L1" }] },
      visibility: { rules: [{ viewer: "", path: "", allow: true }] },
      rules: { custom: [{ id: "tick1", stage: "tick", fn: "x", when: "true" }] },
    }, { authoredFields: { big: { level: "L3" } } });
    expect(r.issues.some((i) => i.path.includes("fields.big"))).toBe(true);
    expect(r.issues.some((i) => i.path.includes("visibility"))).toBe(true);
    expect(r.issues.some((i) => i.message.includes('stage "tick"'))).toBe(true);
  });

  test("schema parse failure returns issues without policy", () => {
    const r = validatePolicyDocument({ tracks: "not-an-object" });
    expect(r.policy).toBeUndefined();
    expect(r.issues.length).toBeGreaterThan(0);
  });
});
