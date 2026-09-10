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
  private readonly storage: StoragePort;
  private readonly fallbackLocale: string;

  constructor(storage: StoragePort, fallbackLocale: string) {
    this.storage = storage;
    this.fallbackLocale = fallbackLocale;
  }

  async warm(localeChain: readonly string[]): Promise<void> {
    for (const loc of localeChain) await this.ensure(loc);
  }

  private async ensure(locale: string): Promise<StringTableResolver> {
    const hit = this.tables.get(locale);
    if (hit) return hit;
    let p = this.pending.get(locale);
    if (!p) {
      p = loadStringTables(this.storage, [locale, this.fallbackLocale]).then((r) => {
        this.tables.set(locale, r);
        this.pending.delete(locale);
        return r;
      });
      this.pending.set(locale, p);
    }
    return p;
  }

  /** Sync translate after `warm()` for that locale. */
  t(locale: string, key: string, params?: FormatParams): string {
    const tables = this.tables.get(locale);
    const engineI18n = createEngineI18n(locale, [this.fallbackLocale]);
    const hit = tables?.resolve(key);
    if (hit !== undefined) return hit;
    return engineI18n.t(key, params);
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
