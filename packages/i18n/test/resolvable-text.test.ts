import { expect, test } from "bun:test";
import { createI18n } from "../src/create-i18n.ts";
import { runWithLocale, scopedI18n } from "../src/locale-context.ts";
import { resolveText, type ResolvableText } from "../src/resolvable-text.ts";

const catalogs = {
  common: {
    en: { end: "End day" },
    fr: { end: "Finir la journée" },
  },
};

test("resolveText passes strings through and reads undefined as empty", () => {
  expect(resolveText("plain")).toBe("plain");
  expect(resolveText(undefined)).toBe("");
});

test("resolveText evaluates a thunk at read time, so each reader sees its own locale", () => {
  const base = createI18n({ locale: "en", catalogs, dev: false });
  const label: ResolvableText = () => scopedI18n(base).t("end");
  expect(resolveText(label)).toBe("End day");
  expect(runWithLocale(base.withLocale("fr"), () => resolveText(label))).toBe("Finir la journée");
  expect(runWithLocale(base.withLocale("en"), () => resolveText(label))).toBe("End day");
});
