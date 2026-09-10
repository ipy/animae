import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createI18n } from "./create-i18n.ts";
import type { CreateI18nOptions, I18nInstance, MessageCatalog } from "./types.ts";

export type I18nProviderProps = {
  /** Active translator instance (alias: `translator`). */
  i18n?: I18nInstance;
  translator?: I18nInstance;
  children: ReactNode;
};

type I18nReactContext = {
  i18n: I18nInstance;
  setLocale: (locale: string) => void;
};

const Ctx = createContext<I18nReactContext | null>(null);

function requireRoot(props: I18nProviderProps): I18nInstance {
  const root = props.i18n ?? props.translator;
  if (!root) throw new Error("I18nProvider requires `i18n` or `translator`");
  return root;
}

/** Bind an `I18nInstance` to the React tree; `setLocale` hot-swaps via `withLocale` and re-renders subscribers. */
export function I18nProvider(props: I18nProviderProps): ReactNode {
  const root = requireRoot(props);
  const [i18n, setI18n] = useState(root);

  useEffect(() => {
    setI18n(root);
  }, [root]);

  const setLocale = useCallback(
    (locale: string) => {
      setI18n((prev) => prev.withLocale(locale));
    },
    [],
  );

  const value = useMemo(() => ({ i18n, setLocale }), [i18n, setLocale]);

  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
}

/** `[locale, setLocale]` for the active translator. */
export function useLocale(): readonly [string, (locale: string) => void] {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useLocale requires I18nProvider");
  return [ctx.i18n.locale, ctx.setLocale] as const;
}

/** Returns `t(key, params)` bound to the current locale (updates when `setLocale` runs). */
export function useT(): (key: string, params?: Parameters<I18nInstance["t"]>[1]) => string {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useT requires I18nProvider");
  const { i18n } = ctx;
  return useCallback((key, params) => i18n.t(key, params), [i18n]);
}

/**
 * Merge eager bundler glob results into `createI18n({ catalogs })` shape.
 * Paths must contain `/locales/<locale>/<namespace>.json` (namespace defaults to filename stem).
 */
export function loadCatalogs(
  modules: Record<string, { default: MessageCatalog } | MessageCatalog>,
): CreateI18nOptions["catalogs"] {
  const catalogs: CreateI18nOptions["catalogs"] = {};
  for (const [path, mod] of Object.entries(modules)) {
    const catalog = "default" in mod && mod.default ? mod.default : mod;
    const m = /\/locales\/([^/]+)\/([^/]+)\.json$/i.exec(path.replace(/\\/g, "/"));
    if (!m) continue;
    const [, locale, nsFile] = m;
    const namespace = nsFile!.replace(/\.json$/i, "");
    catalogs[namespace] ??= {};
    catalogs[namespace]![locale!] = catalog as MessageCatalog;
  }
  return catalogs;
}

/** Convenience when catalogs are known but locale should be controlled in React. */
export function createI18nFromCatalogs(
  locale: string,
  catalogs: CreateI18nOptions["catalogs"],
  opts?: Omit<CreateI18nOptions, "locale" | "catalogs">,
): I18nInstance {
  return createI18n({ locale, catalogs, ...opts });
}
