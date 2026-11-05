import {
  createI18n,
  localeCatalogs,
  matchAvailableLocale,
  negotiateLocale,
  type I18nInstance,
} from "@animae/i18n";
import type { CreateI18nOptions } from "@animae/i18n";
import { hostPackageCatalogs } from "@animae/host";
import enWeb from "../../locales/en/web.json" with { type: "json" };

/** Web server catalogs: the English ones plus every registered locale pack that provides `web` (read at access time). */
const webCatalogs = {
  get web() {
    return localeCatalogs("web", { en: enWeb });
  },
};

/** The web catalogs together with the host's and the engine's. */
export const webPackageCatalogs = {
  get web() {
    return webCatalogs.web;
  },
  get host() {
    return hostPackageCatalogs.host;
  },
  get errors() {
    return hostPackageCatalogs.errors;
  },
  get diagnostics() {
    return hostPackageCatalogs.diagnostics;
  },
};

type CatalogBlock = CreateI18nOptions["catalogs"];

let supplementalCatalogs: CatalogBlock = {};

function mergeCatalogBlocks(base: CatalogBlock, extra: CatalogBlock): CatalogBlock {
  const out: CatalogBlock = { ...base };
  for (const [ns, byLocale] of Object.entries(extra)) {
    const mergedNs = { ...(out[ns] ?? {}) };
    for (const [loc, catalog] of Object.entries(byLocale)) {
      mergedNs[loc] = {
        ...(mergedNs[loc] as Record<string, string>),
        ...(catalog as Record<string, string>),
      };
    }
    out[ns] = mergedNs;
  }
  return out;
}

/** Host apps merge preset / game string tables before serving Web UI snapshots. */
export function registerWebI18nCatalogs(extra: CatalogBlock): void {
  supplementalCatalogs = mergeCatalogBlocks(supplementalCatalogs, extra);
}

function mergedWebCatalogs(): CatalogBlock {
  return mergeCatalogBlocks({ ...webPackageCatalogs } as CatalogBlock, supplementalCatalogs);
}

export function createWebI18n(
  locale?: string,
  env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): I18nInstance {
  const resolved = locale ?? negotiateLocale({ env, defaultLocale: "en" });
  const catalogs = mergedWebCatalogs();
  const matched = matchAvailableLocale(resolved, Object.keys(catalogs.web ?? {})) ?? "en";
  return createI18n({
    locale: matched,
    defaultNamespace: "web",
    catalogs,
  });
}

/** UI locales the web server can serve: `en` and every locale with a `web` catalog (registered packs, supplemental catalogs). */
export function webSupportedLocales(): string[] {
  return Object.keys(mergedWebCatalogs().web ?? {});
}

export function localeDisplayNames(
  locale: string,
  supported: readonly string[] = webSupportedLocales(),
): Array<{ tag: string; name: string }> {
  const dn = new Intl.DisplayNames([locale], { type: "language" });
  return supported.map((tag) => ({ tag, name: dn.of(tag) ?? tag }));
}

export { webCatalogs };
