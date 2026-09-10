import { createI18n, matchAvailableLocale, negotiateLocale, type I18nInstance } from "@animae/i18n";
import { hostPackageCatalogs } from "@animae/host";
import enWeb from "../../locales/en/web.json" with { type: "json" };
import zhWeb from "../../locales/zh-CN/web.json" with { type: "json" };

export const WEB_SUPPORTED_LOCALES = ["en", "zh-CN"] as const;

const webCatalogs = {
  web: { en: enWeb, "zh-CN": zhWeb },
};

export const webPackageCatalogs = { ...webCatalogs, ...hostPackageCatalogs };

export function createWebI18n(
  locale?: string,
  env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): I18nInstance {
  const resolved = locale ?? negotiateLocale({ env, defaultLocale: "en" });
  const matched = matchAvailableLocale(resolved, WEB_SUPPORTED_LOCALES) ?? "en";
  return createI18n({
    locale: matched,
    defaultNamespace: "web",
    catalogs: webPackageCatalogs,
  });
}

export function localeDisplayNames(
  locale: string,
  supported: readonly string[] = WEB_SUPPORTED_LOCALES,
): Array<{ tag: string; name: string }> {
  const dn = new Intl.DisplayNames([locale], { type: "language" });
  return supported.map((tag) => ({ tag, name: dn.of(tag) ?? tag }));
}

export { webCatalogs };
