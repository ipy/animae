import { createI18n, negotiateLocale, type I18nInstance } from "@animae/i18n";
import enTui from "../../locales/en/tui.json" with { type: "json" };
import zhTui from "../../locales/zh-CN/tui.json" with { type: "json" };

const catalogs = { tui: { en: enTui, "zh-CN": zhTui } };

function normalizeTuiCatalogLocale(locale: string): keyof typeof catalogs.tui {
  const tag = locale.trim().toLowerCase();
  if (tag.startsWith("zh")) return "zh-CN";
  return "en";
}

export function createTuiI18n(locale?: string, env: Record<string, string | undefined> = process.env): I18nInstance {
  const raw = locale ?? negotiateLocale({ env, defaultLocale: "en" });
  const resolved = normalizeTuiCatalogLocale(raw);
  return createI18n({ locale: resolved, defaultNamespace: "tui", catalogs });
}

export { catalogs as tuiCatalogs };
