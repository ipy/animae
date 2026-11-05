import { createI18n, localeCatalogs, negotiateLocale, resolveCatalogLocale, type I18nInstance } from "@animae/i18n";
import enTui from "../../locales/en/tui.json" with { type: "json" };

/** TUI catalogs: the English ones plus every registered locale pack that provides `tui` (read at access time). */
const catalogs = {
  get tui() {
    return localeCatalogs("tui", { en: enTui });
  },
};

export function createTuiI18n(locale?: string, env: Record<string, string | undefined> = process.env): I18nInstance {
  const raw = locale ?? negotiateLocale({ env, defaultLocale: "en" });
  const tui = catalogs.tui;
  return createI18n({ locale: resolveCatalogLocale(raw, Object.keys(tui)), defaultNamespace: "tui", catalogs: { tui } });
}

export { catalogs as tuiCatalogs };
