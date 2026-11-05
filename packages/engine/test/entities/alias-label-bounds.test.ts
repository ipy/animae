import { test, expect } from "bun:test";
import { validateAliasLabel, MAX_ALIAS_LABEL_LEN } from "../../src/entities/names.ts";
import { AnimaeError } from "../../src/types.ts";

test("validateAliasLabel rejects empty, overlong, and control characters", () => {
  expect(() => validateAliasLabel("   ")).toThrow(AnimaeError);
  expect(() => validateAliasLabel("a".repeat(MAX_ALIAS_LABEL_LEN + 1))).toThrow(/exceeds/);
  expect(() => validateAliasLabel("ok\u0007")).toThrow(/control/);
  expect(() => validateAliasLabel("fine")).not.toThrow();
});
