import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createI18n } from "../src/create-i18n.ts";
import { buildFallbackChain, negotiateLocale, parseAcceptLanguage } from "../src/negotiate.ts";
import { applyPseudoLocale } from "../src/pseudo-locale.ts";
import { formatMessage } from "../src/format-message.ts";
import { runI18nCheck } from "../src/check.ts";
import { getRequestLocale, runWithLocale, scopedI18n } from "../src/locale-context.ts";

const catalogs = {
  common: {
    en: { greet: "Hello {name}", items: "{count, plural, one {# item} other {# items}}" },
    fr: { greet: "Bonjour {name}", items: "{count, plural, one {# élément} other {# éléments}}" },
  },
};

test("negotiate locale from env and accept-language", () => {
  expect(negotiateLocale({ explicit: "pt-PT" })).toBe("pt-PT");
  expect(negotiateLocale({ env: { LANG: "fr_CA.UTF-8" } })).toBe("fr-CA");
  expect(parseAcceptLanguage("en-US, en;q=0.9, fr-CA;q=0.8")[0]).toBe("en-US");
  expect(buildFallbackChain("en-US")).toEqual(["en-US", "en"]);
  expect(buildFallbackChain("en")).toEqual(["en"]);
  expect(buildFallbackChain("fr-CA")).toEqual(["fr-CA", "fr", "en"]);
  expect(buildFallbackChain("sr-Latn-RS", ["de"])).toEqual(["sr-Latn-RS", "sr-Latn", "sr", "en", "de"]);
});

test("createI18n translates with fallback", () => {
  const i18n = createI18n({ locale: "fr", catalogs, dev: false });
  expect(i18n.t("greet", { name: "A" })).toBe("Bonjour A");
  const en = i18n.withLocale("de-DE");
  expect(en.t("greet", { name: "B" })).toBe("Hello B");
  // A regional variant without a catalog of its own reaches the translation of its language.
  expect(i18n.withLocale("fr-CA").t("greet", { name: "C" })).toBe("Bonjour C");
});

test("dotted keys resolve in the default namespace unless the prefix is a registered namespace", () => {
  const grouped = {
    web: {
      en: { role: { controller_lost: "Another client took control." }, locale: { unsupported: "Unsupported: {locale}" } },
      fr: { role: { controller_lost: "Un autre client a pris la main." }, locale: { unsupported: "Non pris en charge : {locale}" } },
    },
    host: { en: { greeting: "Hi from host" }, fr: { greeting: "Salut de l'hôte" } },
  };
  const i18n = createI18n({ locale: "en", catalogs: grouped, defaultNamespace: "web", dev: false });
  // "role" is a catalog group of the default namespace, not a namespace of its own.
  expect(i18n.t("role.controller_lost")).toBe("Another client took control.");
  expect(i18n.t("locale.unsupported", { locale: "xx" })).toBe("Unsupported: xx");
  // A registered namespace prefix still selects that namespace, and `ns:key` stays explicit.
  expect(i18n.t("host.greeting")).toBe("Hi from host");
  expect(i18n.t("host:greeting")).toBe("Hi from host");
  expect(i18n.has("role.controller_lost")).toBe(true);
  expect(i18n.withLocale("fr").t("role.controller_lost")).toBe("Un autre client a pris la main.");
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
    locales: ["fr"],
    catalogs,
  });
  expect(r.ok).toBe(true);
});

test("i18n check reports unreferenced catalog keys only when it had sources to scan", async () => {
  const many = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`k${i}`, `Message ${i}`]));
  const big = { common: { en: many, fr: many } };
  const noSources = await runI18nCheck({
    referenceLocale: "en",
    locales: ["fr"],
    catalogs: big,
    scanRoots: ["/nonexistent/animae-sources"],
  });
  expect(noSources.warnings).toEqual([]);

  const dir = await mkdtemp(join(tmpdir(), "i18n-scan-"));
  try {
    await writeFile(join(dir, "a.ts"), 'export const label = t("k0");\n');
    const scanned = await runI18nCheck({ referenceLocale: "en", locales: ["fr"], catalogs: big, scanRoots: [dir] });
    expect(scanned.warnings.some((w) => /24 catalog keys not referenced/.test(w))).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("scopedI18n follows the request-scoped locale and is inert outside a request", async () => {
  const base = createI18n({ locale: "en", catalogs, dev: false });
  expect(getRequestLocale()).toBeUndefined();
  expect(scopedI18n(base)).toBe(base);

  const fr = base.withLocale("fr");
  await runWithLocale(fr, async () => {
    expect(scopedI18n(base).locale).toBe("fr");
    expect(scopedI18n(base).t("greet", { name: "A" })).toBe("Bonjour A");
    // Survives awaits: handlers keep their client's locale across async work.
    await new Promise((r) => setTimeout(r, 5));
    expect(scopedI18n(base).t("greet", { name: "B" })).toBe("Bonjour B");
  });

  // Same locale as the request: no needless re-binding.
  await runWithLocale(base, async () => {
    expect(scopedI18n(base)).toBe(base);
  });

  // Concurrent requests with different locales stay isolated.
  const seen: string[] = [];
  await Promise.all([
    runWithLocale(fr, async () => {
      await new Promise((r) => setTimeout(r, 8));
      seen.push(`fr:${scopedI18n(base).locale}`);
    }),
    runWithLocale(base, async () => {
      await new Promise((r) => setTimeout(r, 2));
      seen.push(`en:${scopedI18n(base).locale}`);
    }),
  ]);
  expect(seen.sort()).toEqual(["en:en", "fr:fr"]);
});
