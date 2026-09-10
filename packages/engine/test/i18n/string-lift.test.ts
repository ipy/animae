import { expect, test } from "bun:test";
import { liftStringRefs } from "../../src/i18n/string-resolve.ts";

test("liftStringRefs preserves keys for late UI binding", () => {
  const lifted = liftStringRefs({ name: "$t:hero.title", nested: [{ x: "$t:a.b" }] });
  expect(lifted).toEqual({
    name: { i18n: { key: "hero.title" } },
    nested: [{ x: { i18n: { key: "a.b" } } }],
  });
});
