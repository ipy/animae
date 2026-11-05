import { createI18n, localeCatalogs, negotiateLocale, resolveCatalogLocale, type I18nInstance } from "@animae/i18n";
import enCli from "../../locales/en/cli.json" with { type: "json" };

/** CLI catalogs: the English ones plus every registered locale pack that provides `cli` (read at access time). */
export const cliCatalogs = {
  get cli() {
    return localeCatalogs("cli", { en: enCli });
  },
};

export function createCliI18n(
  locale?: string,
  env: Record<string, string | undefined> = process.env,
): I18nInstance {
  const raw = locale ?? negotiateLocale({ env, defaultLocale: "en" });
  const cli = cliCatalogs.cli;
  return createI18n({ locale: resolveCatalogLocale(raw, Object.keys(cli)), defaultNamespace: "cli", catalogs: { cli } });
}
