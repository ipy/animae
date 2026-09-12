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
  const base = createI18n({
    locale: resolved,
    defaultNamespace: "host",
    catalogs: hostPackageCatalogs,
  });
  // Keys like `command.saved` must stay in the `host` catalog; splitKey would treat `command` as a namespace.
  const hostNs = { ns: "host" as const };
  return {
    ...base,
    t(key, params) {
      return base.t(key, params, hostNs);
    },
    has(key) {
      return base.has(key, hostNs);
    },
    tPseudo(key, params) {
      return base.tPseudo(key, params, hostNs);
    },
  };
}

export { hostCatalogs };
