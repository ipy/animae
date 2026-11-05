import { createI18n, localeCatalogs, negotiateLocale, type I18nInstance } from "@animae/i18n";
import { engineCatalogs } from "@animae/engine";
import enHost from "../../locales/en/host.json" with { type: "json" };

/** Host catalogs: the English ones plus every registered locale pack that provides `host` (read at access time). */
const hostCatalogs = {
  get host() {
    return localeCatalogs("host", { en: enHost });
  },
};

/** The host catalogs together with the engine's, which host messages fall back to for engine errors. */
export const hostPackageCatalogs = {
  get host() {
    return hostCatalogs.host;
  },
  get errors() {
    return engineCatalogs.errors;
  },
  get diagnostics() {
    return engineCatalogs.diagnostics;
  },
};

export function createHostI18n(
  locale?: string,
  env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): I18nInstance {
  const resolved = locale ?? negotiateLocale({ env, defaultLocale: "en" });
  const base = createI18n({
    locale: resolved,
    defaultNamespace: "host",
    catalogs: { host: hostPackageCatalogs.host, errors: hostPackageCatalogs.errors, diagnostics: hostPackageCatalogs.diagnostics },
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
