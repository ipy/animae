import { test, expect } from "bun:test";
import { loadAuthored, createCatalog, displayName, characterTags } from "../../src/authored/index.ts";
import { testStorage } from "../helpers/storage.ts";
import type { PresetRegistry } from "../../src/contracts.ts";
import type { PresetBundle } from "../../src/preset.ts";
import { AnimaeError } from "../../src/types.ts";

async function seedMinimal(storage: ReturnType<typeof testStorage>): Promise<void> {
  await storage.writeAtomic(
    "animae.yaml",
    `seed: 1
policies: []
`,
  );
  await storage.writeAtomic(
    "world/world.yaml",
    `title: Test
language: en
`,
  );
}

test("loadAuthored loads world and hashes files", async () => {
  const s = testStorage();
  await seedMinimal(s);
  await s.writeAtomic("world/locations/tavern.yaml", "id: tavern\nname: Tavern\n");
  const a = await loadAuthored(s);
  expect(a.world.title).toBe("Test");
  expect(a.locations.tavern?.name).toBe("Tavern");
  expect(a.hash).toMatch(/^[a-f0-9]{64}$/);
  expect(a.files["world/locations/tavern.yaml"]).toBeDefined();
});

test("loadAuthored rejects duplicate ids across kinds", async () => {
  const s = testStorage();
  await seedMinimal(s);
  await s.writeAtomic("world/locations/shared.yaml", "id: shared\nname: L\n");
  await s.writeAtomic("world/items/shared.yaml", "id: shared\nname: I\n");
  await expect(loadAuthored(s)).rejects.toMatchObject({ code: "CONFIG_INVALID" });
});

test("loadAuthored merges preset templates under authored", async () => {
  const s = testStorage();
  await seedMinimal(s);
  const presets: PresetRegistry = {
    list: () => [bundle],
    get: (id) => (id === "p1" ? bundle : undefined),
    add: () => {},
  };
  const bundle: PresetBundle = {
    id: "p1",
    extends: [],
    policies: [],
    templates: [
      {
        kind: "character",
        id: "npc-extra",
        template: { fields: { name: { type: "string" } }, guidance: "g", defaults: {}, promote: [] },
      },
    ],
  };
  await s.writeAtomic(
    "templates/character/npc-extra.yaml",
    "fields:\n  name:\n    type: string\nguidance: authored wins\ndefaults: {}\n",
  );
  const a = await loadAuthored(s, { presets });
  expect(a.templates.character["npc-extra"]?.guidance).toBe("authored wins");
});

test("loadAuthored character id must match directory", async () => {
  const s = testStorage();
  await seedMinimal(s);
  await s.writeAtomic(
    "characters/alice/card.md",
    `---
identity:
  id: bob
  name: Alice
tags: []
---
Persona
`,
  );
  await expect(loadAuthored(s)).rejects.toMatchObject({ code: "CONFIG_INVALID" });
});

test("createCatalog merges generated characters", () => {
  const authored = {
    characters: {
      a: {
        id: "a",
        origin: "authored" as const,
        card: {
          identity: { name: "A", summary: "", style_examples: [] },
          constraints: { motives: [], bottom_lines: [], taboos: [] },
          lod: "principal" as const,
          tags: [],
        },
        persona: "",
        traits: { event_mult: {} },
        tracks: { self: {}, toward: {}, overrides: {} },
        goals: [],
        secrets: [],
        relations: [],
        knowledge: [],
      },
    },
  } as unknown as import("../../src/schema/authored.ts").Authored;
  const cat = createCatalog(
    () => authored,
    () => ({
      characters: {
        g: {
          id: "g",
          origin: "generated",
          card: {
            identity: { name: "G", summary: "", style_examples: [] },
            constraints: { motives: [], bottom_lines: [], taboos: [] },
            lod: "extra",
            tags: [],
          },
          persona: "",
          traits: { event_mult: {} },
          tracks: { self: {}, toward: {}, overrides: {} },
          goals: [],
          secrets: [],
          relations: [],
          knowledge: [],
        },
      },
      locations: {},
      items: {},
    }),
  );
  expect(cat.characters()).toHaveLength(2);
  expect(displayName(cat.character("g")!)).toBe("G");
  expect(characterTags(cat.character("a")!)).toEqual([]);
});

test("loadAuthored CONFIG_INVALID aggregates paths", async () => {
  const s = testStorage();
  await seedMinimal(s);
  await s.writeAtomic("world/locations/bad.yaml", "id: bad\n");
  try {
    await loadAuthored(s);
    expect.unreachable();
  } catch (e) {
    expect(e).toBeInstanceOf(AnimaeError);
    expect((e as AnimaeError).message).toContain("world/locations/bad.yaml");
  }
});
