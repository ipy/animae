import { z } from "zod";
import type { Kernel } from "../contracts.ts";
import type { CharacterDef, ItemDef, LocationDef } from "../schema/authored.ts";
import {
  CardFrontmatterSchema,
  GoalsFileSchema,
  ItemDefSchema,
  LocationDefSchema,
  RelationsFileSchema,
  SecretsFileSchema,
  TracksFileSchema,
  TraitsFileSchema,
} from "../schema/authored.ts";
import type { EntityRef, JsonValue } from "../types.ts";
import { AnimaeError } from "../types.ts";
import { slugId } from "./slug.ts";
import { characterToJson } from "./adjudicate.ts";

const KnowledgeSpawnSchema = z.strictObject({
  id: z.string().optional(),
  name: z.string(),
  description: z.string().default(""),
  scope: z.string().default("character"),
  inject: z.enum(["always", "when", "on-demand"]).default("on-demand"),
  when: z.string().optional(),
  tags: z.array(z.string()).default([]),
  priority: z.number().default(0),
  shareable: z.boolean().default(false),
  body: z.string().default(""),
});

export const SpawnCharacterSpecSchema = z.strictObject({
  kind: z.literal("character"),
  id: z.string().optional(),
  card: CardFrontmatterSchema,
  persona: z.string().default(""),
  traits: TraitsFileSchema.default({ event_mult: {} }),
  tracks: TracksFileSchema.default({ self: {}, toward: {}, overrides: {} }),
  goals: GoalsFileSchema.default([]),
  secrets: SecretsFileSchema.default([]),
  relations: RelationsFileSchema.default([]),
  knowledge: z.array(KnowledgeSpawnSchema).default([]),
});

export const SpawnLocationSpecSchema = LocationDefSchema;
export const SpawnItemSpecSchema = ItemDefSchema;

export type SpawnCharacterSpec = z.infer<typeof SpawnCharacterSpecSchema>;
export type SpawnEntitySpec =
  | SpawnCharacterSpec
  | ({ kind: "location" } & LocationDef)
  | ({ kind: "item" } & ItemDef);

export function validateSpawnSpec(raw: unknown): SpawnEntitySpec {
  if (!raw || typeof raw !== "object") throw new AnimaeError("ENTITY_INVALID", "spawn spec must be an object");
  const kind = (raw as { kind?: string }).kind;
  if (kind === "character") return SpawnCharacterSpecSchema.parse(raw);
  if (kind === "location") {
    const loc = LocationDefSchema.parse(raw);
    return { kind: "location" as const, ...loc };
  }
  if (kind === "item") {
    const item = ItemDefSchema.parse(raw);
    return { kind: "item" as const, ...item };
  }
  throw new AnimaeError("ENTITY_INVALID", `unknown spawn kind "${kind ?? ""}"`);
}

export function allocateEntityId(k: Kernel, preferred?: string, kind?: string): string {
  if (preferred) {
    const id = slugId(preferred);
    assertIdAvailable(k, id);
    return id;
  }
  const seq = (k.timeline.state().entitySeq ?? 0) + 1;
  const id = `dyn-${String(seq).padStart(4, "0")}`;
  assertIdAvailable(k, id);
  return id;
}

function assertIdAvailable(k: Kernel, id: string): void {
  if (k.catalog.character(id) || k.catalog.location(id) || k.catalog.item(id)) {
    throw new AnimaeError("ENTITY_DUPLICATE", `entity id "${id}" already exists`);
  }
  if (k.timeline.state().characters[id]) {
    throw new AnimaeError("ENTITY_DUPLICATE", `entity id "${id}" already exists`);
  }
}

export function specToCharacterDef(id: string, spec: SpawnCharacterSpec): CharacterDef {
  const card = { ...spec.card, identity: { ...spec.card.identity, id } };
  return {
    id,
    origin: "generated",
    card,
    persona: spec.persona,
    traits: spec.traits,
    tracks: spec.tracks,
    goals: spec.goals,
    secrets: spec.secrets,
    relations: spec.relations,
    knowledge: spec.knowledge.map((k, i) => ({
      id: k.id ?? `character:${id}/k${i + 1}`,
      name: k.name,
      description: k.description,
      scope: k.scope,
      inject: k.inject,
      when: k.when,
      tags: k.tags,
      priority: k.priority,
      shareable: k.shareable,
      body: k.body,
      path: `generated/${id}/${k.id ?? `k${i + 1}`}.md`,
      owner: id,
    })),
  };
}

export function spawnSpecToPayload(
  k: Kernel,
  spec: SpawnEntitySpec,
  opts?: { id?: string },
): { ref: EntityRef; specJson: Record<string, JsonValue>; data: Record<string, JsonValue> } {
  if (spec.kind === "character") {
    const id = opts?.id ?? spec.id ?? allocateEntityId(k, spec.card.identity.id, "character");
    const def = specToCharacterDef(id, { ...spec, id });
    return {
      ref: { kind: "character", id },
      specJson: JSON.parse(JSON.stringify({ ...spec, id })) as Record<string, JsonValue>,
      data: characterToJson(def),
    };
  }
  if (spec.kind === "location") {
    const id = opts?.id ?? spec.id ?? allocateEntityId(k, spec.id, "location");
    const { kind: _lk, ...locRest } = spec;
    const def: LocationDef = { ...locRest, id };
    return {
      ref: { kind: "location", id },
      specJson: JSON.parse(JSON.stringify(def)) as Record<string, JsonValue>,
      data: def as unknown as Record<string, JsonValue>,
    };
  }
  const id = opts?.id ?? spec.id ?? allocateEntityId(k, spec.id, "item");
  const { kind: _ik, ...itemRest } = spec;
  const def: ItemDef = { ...itemRest, id };
  return {
    ref: { kind: "item", id },
    specJson: JSON.parse(JSON.stringify(def)) as Record<string, JsonValue>,
    data: def as unknown as Record<string, JsonValue>,
  };
}
