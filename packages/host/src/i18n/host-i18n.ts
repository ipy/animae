import { createI18n, negotiateLocale, type I18nInstance } from "@animae/i18n";
import { engineCatalogs } from "@animae/engine";
import enHost from "../../locales/en/host.json" with { type: "json" };
import zhHost from "../../locales/zh-CN/host.json" with { type: "json" };

const hostCatalogs = {
  host: { en: enHost, "zh-CN": zhHost },
};

export const hostPackageCatalogs = { ...hostCatalogs, ...engineCatalogs };

export function createHostI18n(
  locale?: string,
  env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): I18nInstance {
  const resolved = locale ?? negotiateLocale({ env, defaultLocale: "en" });
  return createI18n({
    locale: resolved,
    defaultNamespace: "host",
    catalogs: hostPackageCatalogs,
  });
}

export { hostCatalogs };
