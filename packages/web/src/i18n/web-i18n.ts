import { createI18n, matchAvailableLocale, negotiateLocale, type I18nInstance } from "@animae/i18n";
import type { CreateI18nOptions } from "@animae/i18n";
import { hostPackageCatalogs } from "@animae/host";
import enWeb from "../../locales/en/web.json" with { type: "json" };
import zhWeb from "../../locales/zh-CN/web.json" with { type: "json" };

export const WEB_SUPPORTED_LOCALES = ["en", "zh-CN"] as const;

const webCatalogs = {
  web: { en: enWeb, "zh-CN": zhWeb },
};

export const webPackageCatalogs = { ...webCatalogs, ...hostPackageCatalogs };

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
  return mergeCatalogBlocks(webPackageCatalogs as CatalogBlock, supplementalCatalogs);
}

export function createWebI18n(
  locale?: string,
  env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): I18nInstance {
  const resolved = locale ?? negotiateLocale({ env, defaultLocale: "en" });
  const matched = matchAvailableLocale(resolved, WEB_SUPPORTED_LOCALES) ?? "en";
  return createI18n({
    locale: matched,
    defaultNamespace: "web",
    catalogs: mergedWebCatalogs(),
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
