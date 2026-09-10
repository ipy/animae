import { expect, test } from "bun:test";
import { resolveEngineI18n } from "../../src/i18n/resolve-config.ts";

test("contentLocale defaults to promptLocale when omitted", () => {
  const r = resolveEngineI18n(
    { locale: "en", promptLocale: "zh-CN", fallbackLocale: "en" },
    undefined,
    {},
  );
  expect(r.contentLocale).toBe("zh-CN");
  expect(r.outputLocale).toBe("en");
  expect(r.contentLocaleChain[0]).toBe("zh-CN");
});

test("contentLocale en falls back to promptLocale for overlays", () => {
  const r = resolveEngineI18n(
    { locale: "en", promptLocale: "zh-CN", contentLocale: "en", fallbackLocale: "en" },
    undefined,
    {},
  );
  expect(r.contentLocale).toBe("en");
  expect(r.contentLocaleChain).toContain("zh-CN");
});

test("explicit contentLocale wins over promptLocale default", () => {
  const r = resolveEngineI18n(
    { locale: "en", promptLocale: "zh-CN", contentLocale: "de-DE", fallbackLocale: "en" },
    undefined,
    {},
  );
  expect(r.contentLocale).toBe("de-DE");
});
