import { expect, test } from "bun:test";
import { createTranslator } from "../src/create-translator.ts";

const catalogs = {
  a: { en: { shared: "from-a", onlyA: "A" } },
  b: { en: { shared: "from-b", onlyB: "B" } },
};

test("createTranslator searches namespaces for bare keys", () => {
  const tr = createTranslator({ locale: "en", catalogs, namespaces: ["a", "b"], dev: false });
  expect(tr.t("onlyA")).toBe("A");
  expect(tr.t("onlyB")).toBe("B");
  expect(tr.t("shared")).toBe("from-a");
  expect(tr.has("onlyB")).toBe(true);
  expect(tr.has("missing")).toBe(false);
});

test("explicit ns or colon key bypasses namespace list", () => {
  const tr = createTranslator({ locale: "en", catalogs, namespaces: ["a"], dev: false });
  expect(tr.t("shared", undefined, { ns: "b" })).toBe("from-b");
  expect(tr.t("b:onlyB")).toBe("B");
});
