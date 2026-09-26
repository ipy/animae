import { test, expect } from "bun:test";
import { mergePolicies } from "../../src/policy/merge.ts";

test("mergePolicies deep-merges records", () => {
  const { merged } = mergePolicies([
    { name: "a.yaml", doc: { tracks: { mood: { min: -100, max: 100, initial: 0 } } } },
    { name: "b.yaml", doc: { tracks: { mood: { hysteresis: 2 } } } },
  ]);
  expect((merged.tracks as unknown as { mood: { hysteresis: number } }).mood.hysteresis).toBe(2);
});

test("mergePolicies replaces arrays and warns on override", () => {
  const { merged, warnings } = mergePolicies([
    { name: "a.yaml", doc: { checks: [{ id: "c1", when: "true", expr: '"1d20"', dc: 10 }] } },
    { name: "b.yaml", doc: { checks: [{ id: "c2", when: "true", expr: '"1d20"', dc: 12 }] } },
  ]);
  expect(merged.checks?.length).toBe(1);
  expect(merged.checks?.[0]?.id).toBe("c2");
  expect(warnings.some((w) => w.code === "POLICY_OVERRIDE")).toBe(true);
});

test("mergePolicies $append concatenates", () => {
  const { merged } = mergePolicies([
    { name: "a.yaml", doc: { intent: { types: ["a"] } } },
    { name: "b.yaml", doc: { intent: { types: { $append: ["b"] } } } },
  ]);
  expect(merged.intent?.types).toEqual(["a", "b"]);
});

test("mergePolicies string $append and $prepend concatenate prose blocks", () => {
  const { merged } = mergePolicies([
    { name: "a.yaml", doc: { x: { prompt: { render: "base line\n" } } } },
    { name: "b.yaml", doc: { x: { prompt: { render: { $append: "extra line\n" } } } } },
    { name: "c.yaml", doc: { x: { prompt: { render: { $prepend: "first line\n" } } } } },
  ]);
  expect((merged.x as { prompt: { render: string } }).prompt.render).toBe("first line\nbase line\nextra line\n");
});

test("mergePolicies string $append on an absent value yields the payload alone", () => {
  const { merged } = mergePolicies([{ name: "a.yaml", doc: { x: { prompt: { choices: { $append: "only\n" } } } } }]);
  expect((merged.x as { prompt: { choices: string } }).prompt.choices).toBe("only\n");
});
