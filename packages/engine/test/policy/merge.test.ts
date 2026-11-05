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

test("mergePolicies $prepend puts new list items before the inherited ones", () => {
  const { merged, warnings } = mergePolicies([
    { name: "a.yaml", doc: { intent: { types: ["b", "c"] } } },
    { name: "b.yaml", doc: { intent: { types: { $prepend: ["a"] } } } },
  ]);
  expect(merged.intent?.types).toEqual(["a", "b", "c"]);
  expect(warnings).toEqual([]);
});

test("mergePolicies $append and $prepend onto an absent or non-list value start from an empty list", () => {
  const { merged } = mergePolicies([
    { name: "a.yaml", doc: { intent: { types: 3 }, x: { tail: "text" } } },
    { name: "b.yaml", doc: { intent: { types: { $append: ["z"] } }, x: { tail: { $append: ["only"] }, head: { $prepend: ["only"] } } } },
  ]);
  expect(merged.intent?.types).toEqual(["z"]);
  expect(merged.x).toEqual({ tail: ["only"], head: ["only"] });
});

test("mergePolicies warns about an override with the layer's file and the path, and only when the value changes", () => {
  const { warnings } = mergePolicies([
    { name: "a.yaml", doc: { scene: { turnTaking: "addressed" }, intent: { types: ["a"] }, mode: { n: 1 }, list: [1] } },
    { name: "b.yaml", doc: { scene: { turnTaking: "addressed" }, intent: { types: ["a"] } } },
    { name: "c.yaml", doc: { scene: { turnTaking: "round_robin" }, mode: { n: [2] }, list: [1] } },
  ]);
  expect(warnings).toEqual([
    { code: "POLICY_OVERRIDE", message: "policy value overridden at scene.turnTaking", file: "c.yaml", path: "scene.turnTaking" },
    { code: "POLICY_OVERRIDE", message: "policy value overridden at mode.n", file: "c.yaml", path: "mode.n" },
  ]);
});

test("mergePolicies skips a layer that is not a mapping, warning about it, and ignores an empty layer silently", () => {
  const { merged, warnings } = mergePolicies([
    { name: "a.yaml", doc: { scene: { turnTaking: "addressed" } } },
    { name: "list.yaml", doc: ["not", "a", "mapping"] },
    { name: "text.yaml", doc: "plain text" },
    { name: "empty.yaml", doc: null },
    { name: "absent.yaml", doc: undefined },
  ]);
  expect(merged.scene).toEqual({ turnTaking: "addressed" });
  expect(warnings).toEqual([
    { code: "POLICY_OVERRIDE", message: "policy layer is not an object; skipped", file: "list.yaml" },
    { code: "POLICY_OVERRIDE", message: "policy layer is not an object; skipped", file: "text.yaml" },
  ]);
});
