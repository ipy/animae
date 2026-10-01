// @ts-nocheck
import { expect, test } from "bun:test";
import { buildJsonTree, jsonTreeMatches } from "../ref-client/js/json-tree.js";

test("buildJsonTree renders nested object", () => {
  const { html, plain } = buildJsonTree({ a: 1, b: { c: "x" } });
  expect(html).toContain("jt-key");
  expect(plain).toContain("a:");
});

test("jsonTreeMatches filter", () => {
  expect(jsonTreeMatches({ foo: "bar" }, "bar")).toBe(true);
  expect(jsonTreeMatches({ foo: "bar" }, "missing")).toBe(false);
});
