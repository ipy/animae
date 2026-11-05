import { expect, test } from "bun:test";
import {
  createWebI18n,
  registerWebI18nCatalogs,
  webSupportedLocales,
} from "../src/i18n/web-i18n.ts";

test("registerWebI18nCatalogs merges supplemental strings", () => {
  const key = `coverage_${Date.now()}`;
  registerWebI18nCatalogs({
    web: {
      en: { [key]: "Custom {name}" },
      fr: { [key]: "Perso {name}" },
    },
  });
  const en = createWebI18n("en");
  expect(en.t(key, { name: "A" })).toBe("Custom A");
  const fr = createWebI18n("fr");
  expect(fr.t(key, { name: "B" })).toBe("Perso B");
  expect(webSupportedLocales()).toContain("fr");
});
