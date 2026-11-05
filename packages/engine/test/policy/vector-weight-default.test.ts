import { expect, test } from "bun:test";
import { applyPolicyDefaults } from "../../src/policy/defaults.ts";
import { loadBasePolicy } from "../../../preset-base/test/helpers.ts";

test("bare applyPolicyDefaults keeps vector weight 0.3", () => {
  expect(applyPolicyDefaults({}).memory.weights!.vector).toBe(0.3);
});

test("preset-base overrides vector weight to 0", async () => {
  const policy = await loadBasePolicy();
  expect(policy.memory.weights!.vector).toBe(0);
});
