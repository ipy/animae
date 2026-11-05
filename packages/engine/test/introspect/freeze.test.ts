import { expect, test } from "bun:test";
import { asJson, deepFreeze } from "../../src/introspect/freeze.ts";

test("deepFreeze returns a frozen deep copy and leaves the original untouched", () => {
  const original = { a: { b: [1, { c: 2 }] }, d: "x" };
  const frozen = deepFreeze(original);
  expect(frozen).toEqual(original);
  expect(frozen).not.toBe(original);
  expect(Object.isFrozen(frozen)).toBe(true);
  expect(Object.isFrozen(frozen.a)).toBe(true);
  expect(Object.isFrozen(frozen.a.b)).toBe(true);
  expect(Object.isFrozen(frozen.a.b[1])).toBe(true);
  expect(Object.isFrozen(original)).toBe(false);
  expect(Object.isFrozen(original.a.b)).toBe(false);
  original.a.b.push(3);
  expect(frozen.a.b).toHaveLength(2);
});

test("deepFreeze passes primitives and null through", () => {
  expect(deepFreeze(5)).toBe(5);
  expect(deepFreeze("s")).toBe("s");
  expect(deepFreeze(null)).toBeNull();
  expect(deepFreeze(undefined)).toBeUndefined();
});

test("asJson clones plain values, keeps undefined as undefined and drops what cannot be cloned", () => {
  const value = { a: [1, 2, { b: "c" }] };
  const copy = asJson(value);
  expect(copy).toEqual(value);
  expect(copy).not.toBe(value);
  expect(asJson(undefined)).toBeUndefined();
  expect(asJson(null)).toBeNull();
  expect(asJson(() => 1)).toBeUndefined();
  expect(asJson({ fn: () => 1 })).toBeUndefined();
});
