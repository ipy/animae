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

export type LocaleChangeListener = (locale: string) => void;
const listeners = new Set<LocaleChangeListener>();

export function onLocaleChange(listener: LocaleChangeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitLocaleChange(locale: string): void {
  for (const l of listeners) l(locale);
}
