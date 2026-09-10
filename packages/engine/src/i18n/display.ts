import { localizeDeep, localizeValue, type FormatParams } from "@animae/i18n";
import type { Catalog } from "../contracts.ts";
import type { EngineState } from "../state.ts";
import type { CharacterId } from "../types.ts";
import { entityDisplayName as entityDisplayNameRaw, type DisplayNameOptions } from "../entities/names.ts";
import { createEngineI18n } from "./catalogs.ts";
import { loadStringTables } from "./string-resolve.ts";
import type { StoragePort } from "../ports.ts";
import { resolveEngineI18n } from "./resolve-config.ts";
import type { I18nConfig } from "../schema/authored.ts";
import { renderMessage, type LocalizedMessage } from "./localized-message.ts";

export type DisplayResolver = {
  resolve(value: unknown): unknown;
  entityDisplayName(entityId: CharacterId, opts?: DisplayNameOptions): string;
  t(key: string, params?: FormatParams): string;
};

function resolveAuthoredString(value: unknown, t: (key: string, params?: FormatParams) => string): string {
  const resolved = localizeValue(value, t);
  return typeof resolved === "string" ? resolved : String(resolved ?? "");
}

/** Build a viewer-locale display resolver (UI string tables + engine catalogs). */
export async function createDisplayResolver(opts: {
  storage: StoragePort;
  locale: string;
  i18nConfig?: I18nConfig;
  state: Readonly<EngineState>;
  catalog: Catalog;
}): Promise<DisplayResolver> {
  const resolved = resolveEngineI18n(opts.i18nConfig, { root: opts.storage.root, i18n: { locale: opts.locale } });
  const tables = await loadStringTables(opts.storage, resolved.fallbackChain);
  const engineI18n = createEngineI18n(resolved.locale, [resolved.fallbackLocale]);
  const t = (key: string, params?: FormatParams) => {
    const hit = tables.resolve(key);
    if (hit !== undefined) return hit;
    return engineI18n.t(key, params);
  };
  return {
    t,
    resolve(value: unknown) {
      return localizeDeep(value, t);
    },
    entityDisplayName(entityId: CharacterId, displayOpts?: DisplayNameOptions) {
      const def = opts.catalog.character(entityId);
      const st = opts.state.characters[entityId];
      const alias = opts.state.aliases?.[entityId];
      if (displayOpts?.speaker && displayOpts.viewer) {
        const entry = alias?.addressAs?.[displayOpts.speaker]?.[displayOpts.viewer];
        if (entry?.label) return resolveAuthoredString(entry.label, t);
      }
      if (alias?.nickname?.label) return resolveAuthoredString(alias.nickname.label, t);
      const identity = def?.card?.identity;
      if (identity) {
        const nick = identity.nickname;
        if (nick) return resolveAuthoredString(nick, t);
        return resolveAuthoredString(identity.name, t);
      }
      return entityDisplayNameRaw(opts.state, opts.catalog, entityId, displayOpts);
    },
  };
}

export function resolveDisplayValue(
  value: unknown,
  t: (key: string, params?: FormatParams) => string,
): unknown {
  return localizeDeep(value, t);
}

export function resolveLocalizedMessage(msg: LocalizedMessage | string, t: (key: string, params?: FormatParams) => string): string {
  return renderMessage(msg, t);
}
