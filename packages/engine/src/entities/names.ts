import type { Catalog } from "../contracts.ts";
import type { EngineState, EntityAliasState } from "../state.ts";
import type { CharacterId } from "../types.ts";
import { AnimaeError } from "../types.ts";

export type { EntityAliasEntry, EntityAliasState } from "../state.ts";

export const MAX_ALIAS_LABEL_LEN = 64;

export function emptyAliasState(): EntityAliasState {
  return { aliases: {}, addressAs: {} };
}

export function normalizeAliasKey(label: string): string {
  return label.trim().toLowerCase();
}

export function validateAliasLabel(label: string): void {
  const t = label.trim();
  if (!t) throw new AnimaeError("ENTITY_INVALID", "alias label must be non-empty");
  if (t.length > MAX_ALIAS_LABEL_LEN) {
    throw new AnimaeError("ENTITY_INVALID", `alias label exceeds ${MAX_ALIAS_LABEL_LEN} characters`);
  }
  if (/[\u0000-\u001f\u007f]/.test(t)) {
    throw new AnimaeError("ENTITY_INVALID", "alias label must not contain control characters");
  }
}

export interface DisplayNameOptions {
  /** Viewer/context entity (for address-as overrides). */
  viewer?: CharacterId;
  /** Speaker addressing viewer (enables per-addressee labels). */
  speaker?: CharacterId;
}

/** Resolved display string for prompts and UI (nickname-aware, optional address-as). */
export function entityDisplayName(
  state: Readonly<EngineState>,
  catalog: Catalog,
  entityId: CharacterId,
  opts?: DisplayNameOptions,
): string {
  const def = catalog.character(entityId);
  const st = state.characters[entityId];
  if (state.retired?.[entityId]) {
    return def?.card.identity.name ?? st?.name ?? entityId;
  }
  const alias = state.aliases?.[entityId] ?? emptyAliasState();
  if (opts?.speaker && opts.viewer) {
    const entry = alias.addressAs[opts.speaker]?.[opts.viewer];
    if (entry?.label) return entry.label;
  }
  if (alias.nickname?.label) return alias.nickname.label;
  if (def?.card?.identity) return def.card.identity.nickname ?? def.card.identity.name;
  return st?.name ?? entityId;
}

export interface ResolveEntityOptions {
  viewer?: CharacterId;
  speaker?: CharacterId;
  /** Limit resolution to these character ids (e.g. scene participants). */
  scope?: CharacterId[];
}

export interface ResolvedCharacterRef {
  kind: "character";
  id: CharacterId;
}

/** Resolve id, canonical name, nickname, or alias; throws on ambiguity. */
export function resolveEntityRef(
  state: Readonly<EngineState>,
  catalog: Catalog,
  ref: string,
  opts?: ResolveEntityOptions,
): ResolvedCharacterRef {
  const needle = ref.trim();
  if (!needle) throw new AnimaeError("ENTITY_INVALID", "empty entity reference");

  const candidates = new Map<CharacterId, string[]>();
  const consider = (id: CharacterId, reason: string) => {
    if (state.retired?.[id]) return;
    if (opts?.scope && !opts.scope.includes(id)) return;
    if (!state.characters[id] && !catalog.character(id)) return;
    const list = candidates.get(id) ?? [];
    list.push(reason);
    candidates.set(id, list);
  };

  for (const id of Object.keys(state.characters)) {
    if (id === needle) consider(id, "id");
  }

  for (const def of catalog.characters()) {
    if (state.retired?.[def.id]) continue;
    if (opts?.scope && !opts.scope.includes(def.id)) continue;
    if (def.id === needle) consider(def.id, "id");
    if (def.card.identity.name === needle || def.card.identity.name.toLowerCase() === needle.toLowerCase()) {
      consider(def.id, "canonical_name");
    }
    const nick = def.card.identity.nickname;
    if (nick && (nick === needle || nick.toLowerCase() === needle.toLowerCase())) {
      consider(def.id, "card_nickname");
    }
  }

  const norm = normalizeAliasKey(needle);
  for (const [entityId, alias] of Object.entries(state.aliases ?? {})) {
    if (state.retired?.[entityId]) continue;
    if (opts?.scope && !opts.scope.includes(entityId)) continue;
    if (alias.nickname && normalizeAliasKey(alias.nickname.label) === norm) {
      consider(entityId, "runtime_nickname");
    }
    for (const [key, entry] of Object.entries(alias.aliases)) {
      if (key === norm || normalizeAliasKey(entry.label) === norm) {
        consider(entityId, `alias:${key}`);
      }
    }
  }

  if (candidates.size === 0) {
    throw new AnimaeError("NOT_FOUND", `no entity matches "${needle}"`);
  }
  if (candidates.size > 1) {
    const detail = [...candidates.entries()]
      .map(([id, reasons]) => `${id} (${reasons.join(", ")})`)
      .join("; ");
    throw new AnimaeError("ENTITY_AMBIGUOUS", `ambiguous entity reference "${needle}": ${detail}`, { candidates: [...candidates.keys()] });
  }
  const id = [...candidates.keys()][0]!;
  return { kind: "character", id };
}

export function assertAliasUniqueInScope(
  state: Readonly<EngineState>,
  catalog: Catalog,
  entityId: CharacterId,
  label: string,
  excludeEntity?: CharacterId,
): void {
  const norm = normalizeAliasKey(label);
  for (const [id, alias] of Object.entries(state.aliases ?? {})) {
    if (id === excludeEntity || id === entityId) continue;
    if (alias.nickname && normalizeAliasKey(alias.nickname.label) === norm) {
      throw new AnimaeError("ENTITY_DUPLICATE", `alias "${label}" already used by ${id}`);
    }
    if (alias.aliases[norm]) {
      throw new AnimaeError("ENTITY_DUPLICATE", `alias "${label}" already used by ${id}`);
    }
  }
  for (const def of catalog.characters()) {
    if (def.id === entityId || def.id === excludeEntity) continue;
    if (def.card.identity.name.toLowerCase() === norm) {
      throw new AnimaeError("ENTITY_DUPLICATE", `alias "${label}" collides with name of ${def.id}`);
    }
  }
}
