import { buildFallbackChain, negotiateLocale, normalizeLocaleTag } from "@animae/i18n";
import type { I18nConfig } from "../schema/authored.ts";
import type { CreateEngineOptions } from "../api.ts";

export interface ResolvedEngineI18n {
  locale: string;
  promptLocale: string;
  outputLocale: string;
  contentLocale: string;
  fallbackLocale: string;
  fallbackChain: readonly string[];
}

export function resolveEngineI18n(
  yaml: I18nConfig | undefined,
  opts: CreateEngineOptions | undefined,
  env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): ResolvedEngineI18n {
  const merged: I18nConfig = {
    locale: opts?.i18n?.locale ?? yaml?.locale ?? negotiateLocale({ env, defaultLocale: "en" }),
    promptLocale: opts?.i18n?.promptLocale ?? yaml?.promptLocale ?? "zh-CN",
    outputLocale: opts?.i18n?.outputLocale ?? yaml?.outputLocale,
    contentLocale: opts?.i18n?.contentLocale ?? yaml?.contentLocale,
    fallbackLocale: opts?.i18n?.fallbackLocale ?? yaml?.fallbackLocale ?? "en",
  };
  const locale = normalizeLocaleTag(merged.locale);
  const fallbackLocale = normalizeLocaleTag(merged.fallbackLocale);
  const chain = buildFallbackChain(locale, [fallbackLocale]);
  return {
    locale,
    promptLocale: normalizeLocaleTag(merged.promptLocale),
    outputLocale: normalizeLocaleTag(merged.outputLocale ?? locale),
    contentLocale: normalizeLocaleTag(merged.contentLocale ?? locale),
    fallbackLocale,
    fallbackChain: chain,
  };
}
