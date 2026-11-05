import { expect, test } from "bun:test";
import { createI18n } from "../src/create-i18n.ts";
import { emitLocaleChange, onLocaleChange } from "../src/locale-context.ts";

const catalogs = { common: { en: { x: "X" } } };

test("onLocaleChange registers and unsubscribes listeners", () => {
  const i18n = createI18n({ locale: "en", catalogs, dev: false });
  const seen: string[] = [];
  const off = onLocaleChange((loc) => seen.push(loc));
  emitLocaleChange("fr");
  expect(seen).toEqual(["fr"]);
  off();
  i18n.withLocale("de");
  emitLocaleChange("de");
  expect(seen).toEqual(["fr"]);
});
