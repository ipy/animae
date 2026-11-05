import { describe, expect, test } from "bun:test";
import { validatePolicyDocument } from "../../src/policy/validate.ts";

describe("validatePolicyDocument track order and input.response refs", () => {
  test("flags unsorted track tiers and unknown intent_rules intent", () => {
    const r = validatePolicyDocument({
      events: { types: { other: {} } },
      intent: { types: ["talk"] },
      tracks: {
        mood: {
          scope: "self",
          min: 0,
          max: 100,
          initial: 50,
          tiers: [
            { name: "high", from: 50 },
            { name: "low", from: 10 },
          ],
          hysteresis: 0,
        },
      },
      intent_rules: [{ intent: "missing", when: "true", score: 1 }],
    });
    expect(r.issues.some((i) => i.message.includes("sorted by ascending"))).toBe(true);
    expect(r.issues.some((i) => i.path.includes("intent_rules") && i.message.includes("missing"))).toBe(true);
  });

  test("flags unknown tracks in windows mult and check setType overrides", () => {
    const r = validatePolicyDocument({
      events: { types: { chat: {}, other: {} } },
      intent: { types: ["talk"] },
      tracks: { mood: { scope: "self", min: 0, max: 100, initial: 50, tiers: [], hysteresis: 0 } },
      rules: {
        windows: [{ id: "w1", trigger: "true", durationScenes: 2, mult: { ghost_track: 2 } }],
      },
      checks: [
        {
          id: "c1",
          when: "true",
          expr: '"1d20"',
          dc: 10,
          onSuccess: { setType: "unknown_evt" },
          onFailure: { setType: "also_unknown" },
        },
      ],
    });
    expect(r.issues.some((i) => i.path.includes("windows") && i.message.includes("ghost_track"))).toBe(true);
    expect(r.issues.some((i) => i.path.includes("onSuccess.setType"))).toBe(true);
    expect(r.issues.some((i) => i.path.includes("onFailure.setType"))).toBe(true);
  });

  test("flags unknown emit and intent in input.response mappings", () => {
    const r = validatePolicyDocument({
      events: { types: { other: {} } },
      intent: { types: ["talk"] },
      input: {
        response: {
          injection_suspect: { emit: "not_an_event", intent: "not_an_intent" },
          meta_probe: { intent: "talk" },
        },
      },
    });
    expect(r.issues.some((i) => i.path.includes("injection_suspect") && i.path.includes("emit"))).toBe(true);
    expect(r.issues.some((i) => i.path.includes("injection_suspect") && i.path.includes("intent"))).toBe(true);
  });
});
