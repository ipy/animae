export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [k: string]: JsonValue };

/** Flat or nested message catalog (leaf values are ICU-style strings). */
export interface MessageCatalog {
  [key: string]: string | MessageCatalog;
}

export type CatalogBundle = Record<string, MessageCatalog>;

export type MissingKeyPolicy = "key" | "fallback" | "empty";

export interface CreateI18nOptions {
  locale: string;
  /** ordered BCP-47 tags after primary locale */
  fallbackChain?: readonly string[];
  /** namespace -> locale -> catalog */
  catalogs: Record<string, Record<string, MessageCatalog>>;
  /** default namespace for bare keys */
  defaultNamespace?: string;
  /** dev: warn once per missing key */
  dev?: boolean;
  missingKey?: MissingKeyPolicy;
}

export interface FormatParams {
  [key: string]: JsonValue | undefined;
}

export interface I18nInstance {
  locale: string;
  fallbackChain: readonly string[];
  t(key: string, params?: FormatParams, opts?: { ns?: string }): string;
  has(key: string, opts?: { ns?: string }): boolean;
  dir(): "ltr" | "rtl";
  withLocale(locale: string, fallbackChain?: readonly string[]): I18nInstance;
  /** pseudo-locale transform for QA (e.g. en-XA) */
  tPseudo(key: string, params?: FormatParams, opts?: { ns?: string }): string;
}

export interface LocaleNegotiationOptions {
  explicit?: string;
  env?: Record<string, string | undefined>;
  acceptLanguage?: string;
  defaultLocale?: string;
}

export interface I18nCheckOptions {
  referenceLocale: string;
  locales: readonly string[];
  catalogs: Record<string, Record<string, MessageCatalog>>;
  /** glob roots to scan for t("key") */
  scanRoots?: readonly string[];
  scanGlobs?: readonly string[];
}

export interface I18nCheckResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  coverage: Record<string, { total: number; missing: string[] }>;
  unusedKeys: string[];
}
