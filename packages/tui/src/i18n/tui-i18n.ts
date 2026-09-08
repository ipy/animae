import { createI18n, negotiateLocale, type I18nInstance } from "@animae/i18n";
import enTui from "../../locales/en/tui.json" with { type: "json" };
import zhTui from "../../locales/zh-CN/tui.json" with { type: "json" };

const catalogs = { tui: { en: enTui, "zh-CN": zhTui } };

export function createTuiI18n(locale?: string, env: Record<string, string | undefined> = process.env): I18nInstance {
  const resolved = locale ?? negotiateLocale({ env, defaultLocale: "en" });
  return createI18n({ locale: resolved, defaultNamespace: "tui", catalogs });
}

export { catalogs as tuiCatalogs };
