import { expect, test } from "bun:test";
import { createI18n } from "../src/create-i18n.ts";
import { buildFallbackChain, negotiateLocale, parseAcceptLanguage } from "../src/negotiate.ts";
import { applyPseudoLocale } from "../src/pseudo-locale.ts";
import { formatMessage } from "../src/format-message.ts";
import { runI18nCheck } from "../src/check.ts";
import { getRequestLocale, runWithLocale, scopedI18n } from "../src/locale-context.ts";

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

test("dotted keys resolve in the default namespace unless the prefix is a registered namespace", () => {
  const grouped = {
    web: {
      en: { role: { controller_lost: "Another client took control." }, locale: { unsupported: "Unsupported: {locale}" } },
      "zh-CN": { role: { controller_lost: "其他客户端已接管。" }, locale: { unsupported: "不支持：{locale}" } },
    },
    host: { en: { greeting: "Hi from host" }, "zh-CN": { greeting: "来自 host 的问候" } },
  };
  const i18n = createI18n({ locale: "en", catalogs: grouped, defaultNamespace: "web", dev: false });
  // "role" is a catalog group of the default namespace, not a namespace of its own.
  expect(i18n.t("role.controller_lost")).toBe("Another client took control.");
  expect(i18n.t("locale.unsupported", { locale: "xx" })).toBe("Unsupported: xx");
  // A registered namespace prefix still selects that namespace, and `ns:key` stays explicit.
  expect(i18n.t("host.greeting")).toBe("Hi from host");
  expect(i18n.t("host:greeting")).toBe("Hi from host");
  expect(i18n.has("role.controller_lost")).toBe(true);
  expect(i18n.withLocale("zh-CN").t("role.controller_lost")).toBe("其他客户端已接管。");
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

test("scopedI18n follows the request-scoped locale and is inert outside a request", async () => {
  const base = createI18n({ locale: "en", catalogs, dev: false });
  expect(getRequestLocale()).toBeUndefined();
  expect(scopedI18n(base)).toBe(base);

  const zh = base.withLocale("zh-CN");
  await runWithLocale(zh, async () => {
    expect(scopedI18n(base).locale).toBe("zh-CN");
    expect(scopedI18n(base).t("greet", { name: "A" })).toBe("你好 A");
    // Survives awaits: handlers keep their client's locale across async work.
    await new Promise((r) => setTimeout(r, 5));
    expect(scopedI18n(base).t("greet", { name: "B" })).toBe("你好 B");
  });

  // Same locale as the request: no needless re-binding.
  await runWithLocale(base, async () => {
    expect(scopedI18n(base)).toBe(base);
  });

  // Concurrent requests with different locales stay isolated.
  const seen: string[] = [];
  await Promise.all([
    runWithLocale(zh, async () => {
      await new Promise((r) => setTimeout(r, 8));
      seen.push(`zh:${scopedI18n(base).locale}`);
    }),
    runWithLocale(base, async () => {
      await new Promise((r) => setTimeout(r, 2));
      seen.push(`en:${scopedI18n(base).locale}`);
    }),
  ]);
  expect(seen.sort()).toEqual(["en:en", "zh:zh-CN"]);
});
