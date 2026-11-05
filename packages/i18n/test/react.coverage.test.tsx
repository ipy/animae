import { expect, test } from "bun:test";
import { createI18nFromCatalogs, loadCatalogs } from "../src/react.tsx";

test("loadCatalogs parses glob paths", () => {
  const catalogs = loadCatalogs({
    "/pkg/locales/en/common.json": { default: { hello: "Hi" } },
    "\\pkg\\locales\\fr\\common.json": { greet: "Salut" },
    "/pkg/other.json": { skip: "ignored" },
  });
  expect(catalogs.common?.en).toEqual({ hello: "Hi" });
  expect(catalogs.common?.fr).toEqual({ greet: "Salut" });
});

test("createI18nFromCatalogs builds instance", () => {
  const i18n = createI18nFromCatalogs("en", { common: { en: { x: "X" } } }, { dev: false });
  expect(i18n.t("x")).toBe("X");
});
