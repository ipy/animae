import { expect, test } from "bun:test";
import { createI18n } from "../src/create-i18n.ts";
import { buildFallbackChain, negotiateLocale, parseAcceptLanguage } from "../src/negotiate.ts";
import { applyPseudoLocale } from "../src/pseudo-locale.ts";
import { formatMessage } from "../src/format-message.ts";
import { runI18nCheck } from "../src/check.ts";

const catalogs = {
  common: {
    en: { greet: "Hello {name}", items: "{count, plural, one {# item} other {# items}}" },
    "zh-CN": { greet: "你好 {name}", items: "{count, plural, other {# 项}}" },
  },
};

test("negotiate locale from env and accept-language", () => {
  expect(negotiateLocale({ explicit: "zh-TW" })).toBe("zh-TW");
  expect(negotiateLocale({ env: { LANG: "zh_CN.UTF-8" } })).toBe("zh-CN");
  expect(parseAcceptLanguage("en-US, en;q=0.9, zh-CN;q=0.8")[0]).toBe("en-US");
  expect(buildFallbackChain("zh-TW")).toContain("zh-CN");
});

test("createI18n translates with fallback", () => {
  const i18n = createI18n({ locale: "zh-CN", catalogs, dev: false });
  expect(i18n.t("greet", { name: "A" })).toBe("你好 A");
  const en = i18n.withLocale("de-DE");
  expect(en.t("greet", { name: "B" })).toBe("Hello B");
});

test("plural formatting", () => {
  const i18n = createI18n({ locale: "en", catalogs, dev: false });
  expect(i18n.t("items", { count: 1 })).toContain("1");
});

test("pseudo locale wraps output", () => {
  expect(applyPseudoLocale("Test", "en-XA")).toMatch(/^\[.*\]$/);
});

test("formatMessage number", () => {
  const s = formatMessage("en", "Total: {n, number}", { n: 1200 });
  expect(s).toContain("1");
});

test("i18n check parity", async () => {
  const r = await runI18nCheck({
    referenceLocale: "en",
    locales: ["zh-CN"],
    catalogs,
  });
  expect(r.ok).toBe(true);
});
