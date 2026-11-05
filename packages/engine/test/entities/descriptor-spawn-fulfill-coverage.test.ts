import { expect, test } from "bun:test";
import { descriptorToZod, templateFieldsSchema } from "../../src/entities/descriptor.ts";
import { allocateEntityId, spawnSpecToPayload, specToCharacterDef, validateSpawnSpec } from "../../src/entities/spawn.ts";
import { AnimaeError } from "../../src/types.ts";
import { parseEntityGeneratePayload } from "../../src/entities/fulfill-generate.ts";
import { buildTestKernel, minimalAuthored } from "../helpers/fake-kernel.ts";

test("descriptorToZod covers string enum, numeric bounds, array, object", () => {
  const schema = templateFieldsSchema({
    name: { type: "string", enum: ["a"] },
    n: { type: "integer", min: 1, max: 3 },
    score: { type: "number", min: 0, max: 1, optional: true },
    alive: { type: "boolean" },
    tags: { type: "array", items: { type: "string" }, max: 2 },
    extra: { type: "object", fields: { flag: { type: "boolean" } }, optional: true },
  });
  expect(descriptorToZod({ type: "json" } as unknown as import("../../src/schema/authored.ts").FieldDescriptor).safeParse({}).success).toBe(true);
  expect(schema.parse({ name: "a", n: 2, alive: true, tags: ["x"] })).toMatchObject({ name: "a", n: 2, alive: true });
  expect(() => schema.parse({ name: "b", n: 2, alive: true, tags: [] })).toThrow();
  expect(descriptorToZod({ type: "number", min: 0, max: 1 }).parse(0.5)).toBe(0.5);
});

test("spawn validateSpawnSpec and allocateEntityId", () => {
  const k = buildTestKernel(minimalAuthored());
  k.catalog = {
    character: () => undefined,
    characters: () => [],
    location: () => undefined,
    locations: () => [],
    item: () => undefined,
    template: () => undefined,
    knowledge: () => [],
  };
  Object.assign(k.timeline.state(), { entitySeq: 1 });
  const id = allocateEntityId(k, undefined, "character");
  expect(id).toBe("dyn-0002");
  const spec = validateSpawnSpec({
    kind: "character",
    card: {
      identity: { name: "Hideout", summary: "", style_examples: [] },
      tags: [],
      lod: "extra",
      constraints: { motives: [], bottom_lines: [], taboos: [] },
    },
    persona: "",
    traits: { event_mult: {} },
    tracks: { self: {}, toward: {}, overrides: {} },
    goals: [],
    secrets: [],
    relations: [],
    knowledge: [],
  });
  const { ref, data } = spawnSpecToPayload(k, spec as import("../../src/entities/spawn.ts").SpawnEntitySpec);
  expect(ref.kind).toBe("character");
  expect(data).toBeDefined();
  const withKnowledge = specToCharacterDef("dyn-0003", {
    ...(spec as import("../../src/entities/spawn.ts").SpawnCharacterSpec),
    id: "dyn-0003",
    knowledge: [{ name: "Note", description: "d", scope: "character", inject: "on-demand", tags: [], priority: 0, shareable: false, body: "text" }],
  });
  expect(withKnowledge.knowledge[0]?.owner).toBe("dyn-0003");
  const loc = spawnSpecToPayload(k, {
    kind: "location",
    id: "l1",
    name: "L",
    summary: "",
    tags: [],
    connects: [],
    vars: {},
  });
  expect(loc.ref).toEqual({ kind: "location", id: "l1" });
  const item = spawnSpecToPayload(k, {
    kind: "item",
    id: "i1",
    name: "I",
    summary: "",
    tags: [],
    holder: { kind: "character", ref: "player" },
    vars: {},
  });
  expect(item.ref.kind).toBe("item");
  expect(() => allocateEntityId(k, "npc", "character")).toThrow(AnimaeError);
});

test("validateSpawnSpec accepts a location and an item together with their kind discriminant", () => {
  const loc = validateSpawnSpec({
    kind: "location",
    id: "cellar",
    name: "Cellar",
    summary: "Damp.",
    tags: [],
    connects: [{ to: "tavern", minutes: 2 }],
    vars: {},
  });
  expect(loc).toMatchObject({ kind: "location", id: "cellar", connects: [{ to: "tavern", minutes: 2 }] });
  const item = validateSpawnSpec({
    kind: "item",
    id: "lamp",
    name: "Lamp",
    summary: "",
    tags: [],
    holder: { kind: "character", ref: "player" },
    vars: {},
  });
  expect(item).toMatchObject({ kind: "item", id: "lamp", holder: { kind: "character", ref: "player" } });
});

test("validateSpawnSpec rejects unknown definition keys, unknown kinds and non-objects", () => {
  expect(() => validateSpawnSpec({ kind: "location", id: "x", name: "X", bogus: 1 })).toThrow();
  expect(() => validateSpawnSpec({ kind: "vehicle" })).toThrow(AnimaeError);
  expect(() => validateSpawnSpec("cellar")).toThrow(AnimaeError);
  expect(() => validateSpawnSpec(null)).toThrow(AnimaeError);
});

test("parseEntityGeneratePayload accepts brief requests", () => {
  const payload = parseEntityGeneratePayload({
    request: {
      kind: "character",
      template: "extra",
      brief: { kind: "character", archetype: "wanderer", tags: [], avoidNames: [] },
    },
  });
  expect(payload.request.brief?.archetype).toBe("wanderer");
});
