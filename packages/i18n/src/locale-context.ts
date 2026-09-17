import { AsyncLocalStorage } from "node:async_hooks";
import type { I18nInstance } from "./types.ts";

const store = new AsyncLocalStorage<I18nInstance>();

/** Run `fn` with `i18n` bound for nested async work (e.g. per-request web locale). */
export function runWithLocale<T>(i18n: I18nInstance, fn: () => T): T {
  return store.run(i18n, fn);
}

export function getRequestLocale(): I18nInstance | undefined {
  return store.getStore();
}

/**
 * `base`, re-bound to the request-scoped locale when one is active (see {@link runWithLocale}) and differs from
 * `base.locale`. Process-wide translators (host, game) use this so text produced while handling a client's request
 * follows that client's locale instead of the locale the process started with.
 */
export function scopedI18n(base: I18nInstance): I18nInstance {
  const scoped = store.getStore();
  if (!scoped || scoped.locale === base.locale) return base;
  return base.withLocale(scoped.locale);
}

export type LocaleChangeListener = (locale: string) => void;
const listeners = new Set<LocaleChangeListener>();

export function onLocaleChange(listener: LocaleChangeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitLocaleChange(locale: string): void {
  for (const l of listeners) l(locale);
}
