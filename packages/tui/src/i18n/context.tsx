import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { FormatParams, I18nInstance } from "@animae/i18n";
import { createTuiI18n } from "./tui-i18n.ts";

const TUI_NS = "tui";

function bindTuiT(i18n: I18nInstance): I18nInstance["t"] {
  return (key: string, params?: FormatParams) => i18n.t(key, params, { ns: TUI_NS });
}

const I18nContext = createContext<{ i18n: I18nInstance; setLocale: (locale: string) => void } | null>(null);

export function TuiI18nProvider(props: { initialLocale?: string; children: React.ReactNode }) {
  const [i18n, setI18n] = useState(() => createTuiI18n(props.initialLocale));
  const setLocale = useCallback((locale: string) => {
    setI18n(createTuiI18n(locale));
  }, []);
  const value = useMemo(() => ({ i18n, setLocale }), [i18n, setLocale]);
  return <I18nContext.Provider value={value}>{props.children}</I18nContext.Provider>;
}

export function useTuiI18n(): {
  t: I18nInstance["t"];
  has: (key: string) => boolean;
  locale: string;
  setLocale: (locale: string) => void;
} {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    const fallback = createTuiI18n();
    return {
      t: bindTuiT(fallback),
      has: (key) => fallback.has(key, { ns: TUI_NS }),
      locale: fallback.locale,
      setLocale: () => {},
    };
  }
  return {
    t: bindTuiT(ctx.i18n),
    has: (key) => ctx.i18n.has(key, { ns: TUI_NS }),
    locale: ctx.i18n.locale,
    setLocale: ctx.setLocale,
  };
}
