import { expect, test } from "bun:test";
import { findCjkStringLiterals } from "../src/cjk-scan.ts";

test("findCjkStringLiterals skips allowlisted paths", () => {
  expect(findCjkStringLiterals('"中文"', "src/locales/en/x.json")).toEqual([]);
  expect(findCjkStringLiterals('"中文"', "src/foo.test.ts")).toEqual([]);
});

test("findCjkStringLiterals reports CJK in source literals", () => {
  const src = 'const x = "hello 世界";\nconst y = "ok";';
  const hits = findCjkStringLiterals(src, "src/module.ts");
  expect(hits).toHaveLength(1);
  expect(hits[0]?.line).toBe(1);
});
