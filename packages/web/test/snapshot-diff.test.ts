import { expect, test } from "bun:test";
import { diffSnapshot } from "../src/server/snapshot-diff.ts";

test("diffSnapshot skips identical state", () => {
  expect(diffSnapshot({ a: 1 }, { a: 1 })).toBeNull();
});

test("diffSnapshot detects pending flip", () => {
  const ops = diffSnapshot({ pending: false }, { pending: true });
  expect(ops?.some((o) => o.path === "/pending")).toBe(true);
});
