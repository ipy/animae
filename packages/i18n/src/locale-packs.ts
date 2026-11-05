import { matchAvailableLocale, normalizeLocaleTag } from "./negotiate.ts";
import type { MessageCatalog } from "./types.ts";

/**
 * Namespaces the Animae packages read from locale packs. Every namespace is optional in a pack: a package falls back
 * to its built-in English catalog for a key the pack does not translate.
 */
export const LOCALE_NAMESPACES = [
  /** engine error messages (`@animae/engine`) */
  "errors",
  /** engine diagnostics: validation findings, warnings (`@animae/engine`) */
  "diagnostics",
  /** LLM-facing prompt text of the cognitive pipeline, flat `section id → text` (`@animae/engine`) */
  "prompts",
  /** LLM-facing prompt text of the CG gallery brief, flat `section id → text` (`@animae/engine`) */
  "gallery-prompts",
  /** command-line interface (`@animae/cli`) */
  "cli",
  /** terminal UI (`@animae/tui`) */
  "tui",
  /** host process: stream and session text (`@animae/host`) */
  "host",
  /** web server and protocol messages (`@animae/web`) */
  "web",
  /** reference browser client (`@animae/web`, served as `locales/<tag>.json`) */
  "web-client",
] as const;

export type LocaleNamespace = (typeof LOCALE_NAMESPACES)[number];

/** The translated resources of one locale, contributed by an application or a translation package. */
export interface LocalePack {
  /** BCP 47 tag the resources are written in, for example `fr`, `pt-BR` or `ja`. */
  locale: string;
  /** Message catalogs by namespace (see {@link LOCALE_NAMESPACES}); nested objects are flattened to dotted keys. */
  catalogs: Record<string, MessageCatalog>;
}

interface Registration {
  locale: string;
  catalogs: Record<string, MessageCatalog>;
}

/**
 * The registry lives on `globalThis` under a well-known symbol: a bundler can include more than one copy of this
 * module (an application bundle and a package it depends on), and every copy must see the same packs.
 */
const REGISTRY_KEY = Symbol.for("@animae/i18n:locale-packs");

interface Registry {
  list: Registration[];
  /** bumped on every change, so consumers that cache merged catalogs know when to rebuild them */
  version: number;
}

function registry(): Registry {
  const g = globalThis as unknown as Record<symbol, Registry | undefined>;
  let r = g[REGISTRY_KEY];
  if (!r) {
    r = { list: [], version: 0 };
    g[REGISTRY_KEY] = r;
  }
  return r;
}

function registrations(): Registration[] {
  return registry().list;
}

/** Changes whenever a pack is registered, removed or cleared; read it to invalidate caches built from the packs. */
export function localePacksVersion(): number {
  return registry().version;
}

function mergeCatalog(base: MessageCatalog, over: MessageCatalog): MessageCatalog {
  const out: MessageCatalog = { ...base };
  for (const [key, value] of Object.entries(over)) {
    const prev = out[key];
    out[key] =
      typeof value === "object" && value !== null && typeof prev === "object" && prev !== null
        ? mergeCatalog(prev, value)
        : value;
  }
  return out;
}

/**
 * Registers the translations of one locale. Call it once at start-up, before the engine, the TUI, the CLI or the web
 * server is created: each of them reads the registered packs when it builds its catalogs. Packs for the same locale
 * merge key by key, a later registration overriding an earlier one (and the built-in English catalog, if the pack is
 * for `en`). Returns a function that removes the pack again.
 */
export function registerLocalePack(pack: LocalePack): () => void {
  const entry: Registration = { locale: normalizeLocaleTag(pack.locale), catalogs: pack.catalogs };
  const reg = registry();
  reg.list.push(entry);
  reg.version += 1;
  return () => {
    const at = reg.list.indexOf(entry);
    if (at < 0) return;
    reg.list.splice(at, 1);
    reg.version += 1;
  };
}

/** Removes every registered pack. For tests and for hosts that reconfigure at runtime. */
export function clearLocalePacks(): void {
  const reg = registry();
  reg.list.length = 0;
  reg.version += 1;
}

/** Locales that have at least one registered pack, optionally only those that provide `namespace`. */
export function registeredLocales(namespace?: string): string[] {
  const out: string[] = [];
  for (const r of registrations()) {
    if (namespace !== undefined && !r.catalogs[namespace]) continue;
    if (!out.includes(r.locale)) out.push(r.locale);
  }
  return out;
}

/**
 * `builtIn` (locale → catalog, as the package ships it) with every registered pack for `namespace` merged over it.
 * The result is a fresh object: callers may keep it for the lifetime of one i18n instance.
 */
export function localeCatalogs(
  namespace: string,
  builtIn: Record<string, MessageCatalog>,
): Record<string, MessageCatalog> {
  const out: Record<string, MessageCatalog> = {};
  for (const [locale, catalog] of Object.entries(builtIn)) out[normalizeLocaleTag(locale)] = catalog;
  for (const r of registrations()) {
    const catalog = r.catalogs[namespace];
    if (!catalog) continue;
    out[r.locale] = out[r.locale] ? mergeCatalog(out[r.locale]!, catalog) : catalog;
  }
  return out;
}

/** The catalog locale to use for `requested`: the closest of `available` (`pt-BR` → `pt`, `pt` → `pt-BR`), else `en`. */
export function resolveCatalogLocale(requested: string, available: readonly string[]): string {
  return matchAvailableLocale(requested, available) ?? "en";
}
