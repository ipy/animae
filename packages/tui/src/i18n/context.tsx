import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { I18nInstance } from "@animae/i18n";
import { createTuiI18n } from "./tui-i18n.ts";

const I18nContext = createContext<{ i18n: I18nInstance; setLocale: (locale: string) => void } | null>(null);

export function TuiI18nProvider(props: { initialLocale?: string; children: React.ReactNode }) {
  const [i18n, setI18n] = useState(() => createTuiI18n(props.initialLocale));
  const setLocale = useCallback((locale: string) => {
    setI18n(createTuiI18n(locale));
  }, []);
  const value = useMemo(() => ({ i18n, setLocale }), [i18n, setLocale]);
  return <I18nContext.Provider value={value}>{props.children}</I18nContext.Provider>;
}

export function useTuiI18n(): { t: I18nInstance["t"]; locale: string; setLocale: (locale: string) => void } {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    const fallback = createTuiI18n();
    return { t: fallback.t.bind(fallback), locale: fallback.locale, setLocale: () => {} };
  }
  return { t: ctx.i18n.t.bind(ctx.i18n), locale: ctx.i18n.locale, setLocale: ctx.setLocale };
}
