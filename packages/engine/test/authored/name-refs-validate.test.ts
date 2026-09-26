import { test, expect } from "bun:test";
import { warnUnknownNameRefs } from "../../src/authored/name-refs-validate.ts";
import type { Authored } from "../../src/schema/authored.ts";

test("warnUnknownNameRefs warns on missing character id", () => {
  const warnings: string[] = [];
  const authored = {
    characters: {
      npc1: {
        id: "npc1",
        origin: "authored" as const,
        persona: "Hello {{name:ghost}}.",
        card: { identity: { name: "Npc" }, tags: [], style: "", constraints: { motives: [], taboos: [], bottom_lines: [] } },
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
    fields: {},
    knowledge: [],
    templates: { character: {}, scene: {} },
    anchors: [],
    beats: [],
    world: { title: "t", language: "en" },
    config: { seed: 1, policies: [] },
  } as unknown as Authored;
  warnUnknownNameRefs(authored, (_c, msg) => warnings.push(msg));
  expect(warnings.some((w) => w.includes("ghost"))).toBe(true);
});

test("warnUnknownNameRefs accepts i18n-shaped location fields", () => {
  const warnings: string[] = [];
  const authored = {
    characters: {},
    locations: {
      loc1: {
        id: "loc1",
        name: { i18n: { key: "place.name" } },
        description: { $t: "place.desc" },
        connects: [],
      },
    },
    items: {},
    fields: {},
    knowledge: [],
    templates: { character: {}, scene: {}, location: {} },
    anchors: [],
    beats: [],
    world: { title: "t", language: "en" },
    config: { seed: 1, policies: [] },
  } as unknown as Authored;
  warnUnknownNameRefs(authored, (_c, msg) => warnings.push(msg));
  expect(warnings).toEqual([]);
});
