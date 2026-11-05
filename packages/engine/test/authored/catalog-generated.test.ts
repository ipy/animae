import { describe, expect, test } from "bun:test";
import { createCatalog } from "../../src/authored/catalog.ts";
import type { Authored, CharacterDef, LocationDef } from "../../src/schema/authored.ts";
import type { EngineState } from "../../src/state.ts";

const baseAuthored: Authored = {
  hash: "h",
  config: { seed: 1, policies: [] },
  world: {
    title: "t",
    language: "en",
    calendar: { units: { minute: 1, hour: 60, day: 1440 }, sceneMinutes: 30, turnMinutes: 1, chapters: [] },
    start: { day: 1, minute: 0 },
    vars: {},
    public_vars: [],
    player: "player",
    start_location: "loc",
    factions: {},
  },
  locations: { loc_a: { id: "loc_a", name: "A", summary: "", tags: [], connects: [], vars: {} } },
  items: {},
  characters: {
    c_auth: {
      id: "c_auth",
      origin: "authored",
      card: {
        identity: { name: "Auth", summary: "", style_examples: [] },
        constraints: { motives: [], bottom_lines: [], taboos: [] },
        tags: [],
        lod: "principal",
      },
      persona: "",
      traits: { event_mult: {} },
      tracks: { self: {}, toward: {}, overrides: {} },
      goals: [],
      secrets: [],
      relations: [],
      knowledge: [
        {
          id: "k1",
          name: "K",
          body: "b",
          scope: "character",
          inject: "on-demand",
          tags: [],
          description: "",
          path: "characters/c_auth/k1.md",
          priority: 0,
          shareable: false,
        },
      ],
    },
  },
  fields: {},
  files: {},
  anchors: [],
  schedule: [],
  decks: [],
  knowledge: [
    {
      id: "k0",
      name: "World",
      body: "w",
      scope: "world",
      inject: "on-demand",
      tags: [],
      description: "",
      path: "knowledge/world/k0.md",
      priority: 0,
      shareable: false,
    },
  ],
  beats: [],
  templates: { character: {}, location: {}, item: {} },
  exceptions: {},
};

describe("createCatalog", () => {
  test("merges authored and generated entities; generated wins on id clash", () => {
    const genChar: CharacterDef = {
      ...baseAuthored.characters.c_auth!,
      id: "c_gen",
      origin: "generated",
      knowledge: [
        {
          id: "k2",
          name: "G",
          body: "g",
          scope: "character",
          inject: "on-demand",
          tags: [],
          description: "",
          path: "characters/c_gen/k2.md",
          priority: 0,
          shareable: false,
        },
      ],
    };
    const genLoc: LocationDef = { id: "loc_b", name: "B", summary: "", tags: [], connects: [], vars: {} };
    const generated: EngineState["generated"] = {
      characters: { c_gen: genChar },
      locations: { loc_b: genLoc },
      items: {},
    };
    const catalog = createCatalog(() => baseAuthored, () => generated);
    expect(catalog.character("c_auth")?.id).toBe("c_auth");
    expect(catalog.character("c_gen")?.origin).toBe("generated");
    expect(catalog.locations().map((l) => l.id).sort()).toEqual(["loc_a", "loc_b"]);
    const knowledgeIds = catalog.knowledge().map((d) => d.id).sort();
    expect(knowledgeIds).toEqual(["k0", "k1", "k2"]);
  });
});
