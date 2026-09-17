import { createI18n, negotiateLocale, type I18nInstance } from "@animae/i18n";
import enCli from "../../locales/en/cli.json" with { type: "json" };
import zhCli from "../../locales/zh-CN/cli.json" with { type: "json" };

export const cliCatalogs = { cli: { en: enCli, "zh-CN": zhCli } };

function normalizeCliLocale(locale: string): keyof typeof cliCatalogs.cli {
  const tag = locale.trim().toLowerCase();
  if (tag.startsWith("zh")) return "zh-CN";
  return "en";
}

export function createCliI18n(
  locale?: string,
  env: Record<string, string | undefined> = process.env,
): I18nInstance {
  const raw = locale ?? negotiateLocale({ env, defaultLocale: "en" });
  const resolved = normalizeCliLocale(raw);
  return createI18n({ locale: resolved, defaultNamespace: "cli", catalogs: cliCatalogs });
}
