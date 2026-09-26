import type { FormatParams } from "@animae/i18n";
import type { StoragePort } from "../ports.ts";
import { createEngineI18n } from "./catalogs.ts";
import { loadStringTables, type StringTableResolver } from "./string-resolve.ts";
import { resolveDisplayValue } from "./display.ts";
import { entityDisplayName as entityDisplayNameRaw, type DisplayNameOptions } from "../entities/names.ts";
import type { Catalog } from "../contracts.ts";
import type { EngineState } from "../state.ts";
import type { CharacterId } from "../types.ts";
import { localizeValue } from "@animae/i18n";

export class StringTableCache {
  private readonly tables = new Map<string, StringTableResolver>();
  private readonly pending = new Map<string, Promise<StringTableResolver>>();
  /** Per-locale tables without the fallback locale (see `lookup`). */
  private readonly strictTables = new Map<string, StringTableResolver>();
  private readonly strictPending = new Map<string, Promise<void>>();
  private readonly storage: StoragePort;
  private readonly fallbackLocale: string;
  private readonly presetStrings: Record<string, Record<string, string>>;

  constructor(
    storage: StoragePort,
    fallbackLocale: string,
    presetStrings: Record<string, Record<string, string>> = {},
  ) {
    this.storage = storage;
    this.fallbackLocale = fallbackLocale;
    this.presetStrings = presetStrings;
  }

  async warm(localeChain: readonly string[]): Promise<void> {
    for (const loc of localeChain) {
      await this.ensure(loc);
      await this.ensureStrict(loc);
    }
  }

  private async ensureStrict(locale: string): Promise<void> {
    if (this.strictTables.has(locale)) return;
    let p = this.strictPending.get(locale);
    if (!p) {
      p = loadStringTables(this.storage, [locale]).then((r) => {
        const own = this.presetStrings[locale];
        this.strictTables.set(locale, {
          warnings: r.warnings,
          resolve: (key: string) => own?.[key] ?? r.resolve(key),
          entries: () => ({ ...r.entries(), ...own }),
        });
        this.strictPending.delete(locale);
      });
      this.strictPending.set(locale, p);
    }
    await p;
  }

  private async ensure(locale: string): Promise<StringTableResolver> {
    const hit = this.tables.get(locale);
    if (hit) return hit;
    let p = this.pending.get(locale);
    if (!p) {
      p = loadStringTables(this.storage, [locale, this.fallbackLocale]).then((r) => {
        const presetStrings = this.presetStrings;
        const fallbackLocale = this.fallbackLocale;
        const merged: StringTableResolver = {
          warnings: r.warnings,
          resolve(key: string) {
            for (const loc of [locale, fallbackLocale]) {
              const hit = presetStrings[loc]?.[key];
              if (hit !== undefined) return hit;
            }
            return r.resolve(key);
          },
          entries: () => ({ ...r.entries(), ...presetStrings[locale], ...presetStrings[fallbackLocale] }),
        };
        this.tables.set(locale, merged);
        this.pending.delete(locale);
        return merged;
      });
      this.pending.set(locale, p);
    }
    return p;
  }

  /**
   * The warmed table for `locale`, or for its bare language when only that was warmed (a viewer asking for `en-US`
   * is served by the `en` tables instead of silently falling through to the UI catalogs).
   */
  private nearest<T>(byLocale: Map<string, T>, locale: string): T | undefined {
    return byLocale.get(locale) ?? byLocale.get(locale.split("-")[0]!);
  }

  /** Sync translate after `warm()` for that locale. */
  t(locale: string, key: string, params?: FormatParams): string {
    const tables = this.nearest(this.tables, locale);
    const engineI18n = createEngineI18n(locale, [this.fallbackLocale]);
    const hit = tables?.resolve(key);
    if (hit !== undefined) return hit;
    return engineI18n.t(key, params);
  }

  /**
   * Sync lookup of one key in exactly `locale`'s tables after `warm()`; `undefined` when that locale has no such
   * string. Unlike `t`, this never falls back to another locale or to the catalog.
   */
  lookup(locale: string, key: string): string | undefined {
    return this.nearest(this.strictTables, locale)?.resolve(key);
  }

  resolveValue(locale: string, value: unknown): unknown {
    return resolveDisplayValue(value, (key, params) => this.t(locale, key, params));
  }

  entityDisplayName(
    locale: string,
    state: Readonly<EngineState>,
    catalog: Catalog,
    entityId: CharacterId,
    opts?: DisplayNameOptions,
  ): string {
    const t = (key: string, params?: FormatParams) => this.t(locale, key, params);
    const def = catalog.character(entityId);
    const alias = state.aliases?.[entityId];
    if (opts?.speaker && opts?.viewer) {
      const entry = alias?.addressAs?.[opts.speaker]?.[opts.viewer];
      if (entry?.label) {
        const v = localizeValue(entry.label, t);
        return typeof v === "string" ? v : String(v);
      }
    }
    if (alias?.nickname?.label) {
      const v = localizeValue(alias.nickname.label, t);
      return typeof v === "string" ? v : String(v);
    }
    const identity = def?.card?.identity;
    if (identity) {
      const nick = identity.nickname;
      if (nick) {
        const v = localizeValue(nick, t);
        return typeof v === "string" ? v : String(v);
      }
      const v = localizeValue(identity.name, t);
      return typeof v === "string" ? v : String(v);
    }
    return entityDisplayNameRaw(state, catalog, entityId, opts);
  }
}
