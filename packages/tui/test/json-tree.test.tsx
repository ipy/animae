import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToString } from "ink";
import { JsonTree } from "../src/utils/json-tree.tsx";

describe("JsonTree", () => {
  test("renders nested objects and truncates depth", () => {
    const deep = { a: { b: { c: { d: { e: 1 } } } } };
    const out = renderToString(createElement(JsonTree, { value: deep, maxDepth: 1 }));
    expect(out).toContain("a:");
    expect(out).toContain("…");
  });

  test("renders arrays with overflow marker", () => {
    const arr = Array.from({ length: 12 }, (_, i) => i);
    const out = renderToString(createElement(JsonTree, { value: arr, maxDepth: 4 }));
    expect(out).toContain("12 items");
  });

  test("renders primitives and null", () => {
    const out = renderToString(
      createElement(JsonTree, { value: { n: 3, ok: true, s: "x", nil: null }, maxDepth: 3 }),
    );
    expect(out).toContain('"x"');
    expect(out).toContain("null");
  });
});
