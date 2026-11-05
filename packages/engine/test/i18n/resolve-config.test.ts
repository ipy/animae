import { expect, test } from "bun:test";
import { resolveEngineI18n } from "../../src/i18n/resolve-config.ts";

test("contentLocale defaults to promptLocale when omitted", () => {
  const r = resolveEngineI18n(
    { locale: "en", promptLocale: "fr", fallbackLocale: "en" },
    undefined,
    {},
  );
  expect(r.contentLocale).toBe("fr");
  expect(r.outputLocale).toBe("en");
  expect(r.contentLocaleChain[0]).toBe("fr");
});

test("contentLocale en falls back to promptLocale for overlays", () => {
  const r = resolveEngineI18n(
    { locale: "en", promptLocale: "fr", contentLocale: "en", fallbackLocale: "en" },
    undefined,
    {},
  );
  expect(r.contentLocale).toBe("en");
  expect(r.contentLocaleChain).toContain("fr");
});

test("explicit contentLocale wins over promptLocale default", () => {
  const r = resolveEngineI18n(
    { locale: "en", promptLocale: "fr", contentLocale: "de-DE", fallbackLocale: "en" },
    undefined,
    {},
  );
  expect(r.contentLocale).toBe("de-DE");
});
