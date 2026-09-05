import type { CharacterDef, ItemDef, LocationDef, Template } from "../schema/authored.ts";
import { BottomLineSchema, CardFrontmatterSchema } from "../schema/authored.ts";
import type { Catalog } from "../contracts.ts";
import type { EntityRef, JsonValue, Lod } from "../types.ts";
import { AnimaeError } from "../types.ts";
import { slugId } from "./slug.ts";
import { z } from "zod";

export function adjudicateProposal(
  kind: "character" | "location" | "item",
  template: Template,
  proposal: Record<string, unknown>,
  catalog: Catalog,
  hints?: Record<string, unknown>,
): { ref: EntityRef; data: Record<string, JsonValue> } {
  const merged = deepMerge(template.defaults, proposal) as Record<string, unknown>;
  const hintId = typeof hints?.id === "string" ? hints.id : undefined;
  const name =
    (typeof merged.name === "string" && merged.name) ||
    (typeof (merged.identity as { name?: string } | undefined)?.name === "string" && (merged.identity as { name: string }).name) ||
    hintId ||
    "unnamed";
  const baseId = hintId ? slugId(hintId) : slugId(String(name));
  const exists = (x: string) =>
    catalog.character(x) !== undefined || catalog.location(x) !== undefined || catalog.item(x) !== undefined;
  if (exists(baseId)) {
    throw new AnimaeError("ENTITY_DUPLICATE", `entity id "${baseId}" already exists`);
  }
  const id = baseId;

  const lod = (template.lod ?? (merged.lod as Lod | undefined) ?? "extra") as Lod;
  validateBottomLines(merged);

  if (kind === "character") {
    const def = buildCharacterDef(id, merged, lod);
    return { ref: { kind: "character", id }, data: characterToJson(def) };
  }
  if (kind === "location") {
    const def: LocationDef = {
      id,
      name: String(merged.name ?? name),
      summary: String(merged.summary ?? ""),
      tags: Array.isArray(merged.tags) ? (merged.tags as string[]) : [],
      connects: [],
      vars: (merged.vars as Record<string, JsonValue>) ?? {},
      description: typeof merged.description === "string" ? merged.description : undefined,
    };
    return { ref: { kind: "location", id }, data: def as unknown as Record<string, JsonValue> };
  }
  const def: ItemDef = {
    id,
    name: String(merged.name ?? name),
    summary: String(merged.summary ?? ""),
    tags: Array.isArray(merged.tags) ? (merged.tags as string[]) : [],
    vars: (merged.vars as Record<string, JsonValue>) ?? {},
    holder: merged.holder as ItemDef["holder"],
  };
  return { ref: { kind: "item", id }, data: def as unknown as Record<string, JsonValue> };
}

function buildCharacterDef(id: string, merged: Record<string, unknown>, lod: Lod): CharacterDef {
  const identity = (merged.identity as Record<string, unknown> | undefined) ?? {};
  const card = CardFrontmatterSchema.parse({
    identity: {
      id,
      name: String(identity.name ?? merged.name ?? id),
      summary: String(identity.summary ?? merged.summary ?? ""),
      language: identity.language,
      style_examples: identity.style_examples ?? merged.style_examples ?? [],
      greeting: identity.greeting ?? merged.greeting,
      nickname: identity.nickname,
      color: identity.color,
    },
    constraints: merged.constraints ?? { motives: [], bottom_lines: [], taboos: [] },
    lod,
    tags: merged.tags ?? [],
    style: merged.style,
    x_import: merged.x_import,
  });
  return {
    id,
    origin: "generated",
    card,
    persona: String(merged.persona ?? merged.description ?? ""),
    traits: (merged.traits as CharacterDef["traits"]) ?? { event_mult: {} },
    tracks: (merged.tracks as CharacterDef["tracks"]) ?? { self: {}, toward: {}, overrides: {} },
    goals: (merged.goals as CharacterDef["goals"]) ?? [],
    secrets: (merged.secrets as CharacterDef["secrets"]) ?? [],
    relations: (merged.relations as CharacterDef["relations"]) ?? [],
    knowledge: [],
  };
}

function validateBottomLines(merged: Record<string, unknown>): void {
  const constraints = merged.constraints as { bottom_lines?: unknown[] } | undefined;
  const lines = constraints?.bottom_lines ?? merged.bottom_lines;
  if (!lines) return;
  const r = z.array(BottomLineSchema).safeParse(lines);
  if (!r.success) throw new AnimaeError("ENTITY_INVALID", "invalid bottom_lines in proposal");
}

function characterToJson(def: CharacterDef): Record<string, JsonValue> {
  return JSON.parse(JSON.stringify(def)) as Record<string, JsonValue>;
}

function deepMerge(base: Record<string, unknown>, over: Record<string, unknown>): Record<string, unknown> {
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v && typeof v === "object" && !Array.isArray(v) && typeof out[k] === "object" && out[k] && !Array.isArray(out[k])) {
      out[k] = deepMerge(out[k] as Record<string, unknown>, v as Record<string, unknown>);
    } else if (v !== undefined) out[k] = v;
  }
  return out;
}

export const LOD_RANK: Record<Lod, number> = { extra: 0, supporting: 1, principal: 2 };

export function nextLod(current: Lod): Lod | undefined {
  if (current === "extra") return "supporting";
  if (current === "supporting") return "principal";
  return undefined;
}
