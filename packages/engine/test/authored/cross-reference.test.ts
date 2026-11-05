import { describe, expect, test } from "bun:test";
import { crossReferenceAuthored } from "../../src/authored/validate.ts";
import type { Authored } from "../../src/schema/authored.ts";

function baseAuthored(over: Partial<Authored> = {}): Authored {
  return {
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
      start_location: "a",
      factions: {},
    },
    locations: {
      a: { id: "a", name: "A", summary: "", tags: [], connects: [{ to: "missing", kind: "path" }], vars: {} },
    },
    items: {},
    fields: {},
    characters: {
      npc: {
        id: "npc",
        origin: "authored",
        card: {
          identity: { name: "N", summary: "", style_examples: [] },
          constraints: { motives: [], bottom_lines: [], taboos: [] },
          tags: [],
          lod: "principal",
        },
        persona: "",
        traits: { event_mult: {} },
        tracks: { self: {}, toward: {}, overrides: {} },
        goals: [],
        secrets: [],
        relations: [{ to: "ghost", kind: "ally", share: "false" }],
        knowledge: [],
      },
    },
    anchors: [{ id: "anc", refs: ["ghost"], when: "true" }],
    beats: [{ id: "b1", fields: ["missing_field"], when: "true" }],
    templates: { character: {}, location: {}, item: {} },
    knowledge: [],
    schedule: [],
    decks: [],
    exceptions: {},
    files: {},
    ...over,
  } as Authored;
}

describe("crossReferenceAuthored", () => {
  test("reports unknown location connects and beat fields", () => {
    const issues = crossReferenceAuthored(baseAuthored(), () => {});
    expect(issues.some((i) => i.message.includes('unknown location "missing"'))).toBe(true);
    expect(issues.some((i) => i.message.includes('unknown field "missing_field"'))).toBe(true);
  });

  test("duplicate entity ids across locations and items", () => {
    const authored = baseAuthored({
      locations: { dup: { id: "dup", name: "D", summary: "", tags: [], connects: [], vars: {} } },
      items: { dup: { id: "dup", name: "I", summary: "", tags: [], vars: {} } },
    });
    const issues = crossReferenceAuthored(authored, () => {});
    expect(issues.some((i) => i.message.includes('duplicate id "dup"'))).toBe(true);
  });

  test("warns on anchor ref and missing relation target", () => {
    const warnings: string[] = [];
    crossReferenceAuthored(baseAuthored(), (_c, msg) => warnings.push(msg));
    expect(warnings.some((w) => w.includes("ghost"))).toBe(true);
    expect(warnings.some((w) => w.includes("relation"))).toBe(true);
  });
});
