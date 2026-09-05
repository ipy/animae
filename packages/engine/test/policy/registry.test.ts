import { test, expect } from "bun:test";
import { createPresetRegistry, resolvePresetChain } from "../../src/policy/registry.ts";
import { AnimaeError } from "../../src/types.ts";

test("resolvePresetChain topological order", () => {
  const reg = createPresetRegistry([
    { id: "base", extends: [], policies: [{ name: "b", doc: { x: 1 } }] },
    { id: "child", extends: ["base"], policies: [{ name: "c", doc: { y: 2 } }] },
  ]);
  const chain = resolvePresetChain(reg, "child");
  expect(chain.map((b) => b.id)).toEqual(["base", "child"]);
});

test("resolvePresetChain detects cycle", () => {
  const reg = createPresetRegistry([
    { id: "a", extends: ["b"], policies: [] },
    { id: "b", extends: ["a"], policies: [] },
  ]);
  expect(() => resolvePresetChain(reg, "a")).toThrow(AnimaeError);
});

test("resolvePresetChain missing preset", () => {
  const reg = createPresetRegistry();
  expect(() => resolvePresetChain(reg, "nope")).toThrow(AnimaeError);
});
