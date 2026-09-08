/** Browser-safe entry (no node:fs). */
export { createI18n } from "./create-i18n.ts";
export { negotiateLocale, parseAcceptLanguage, buildFallbackChain, normalizeLocaleTag, matchAvailableLocale, textDirection } from "./negotiate.ts";
export { formatMessage, flattenCatalog, extractPlaceholders } from "./format-message.ts";
export { applyPseudoLocale, isPseudoLocale } from "./pseudo-locale.ts";
export type * from "./types.ts";
