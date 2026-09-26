import { test, expect } from "bun:test";
import { validateAliasLabel } from "../../src/entities/names.ts";
import { AnimaeError } from "../../src/types.ts";

test("validateAliasLabel rejects injection markers", () => {
  expect(() => validateAliasLabel("{{name:player}}")).toThrow(AnimaeError);
  expect(() => validateAliasLabel("$t:hero.name")).toThrow(AnimaeError);
  expect(() => validateAliasLabel("Mira")).not.toThrow();
});
