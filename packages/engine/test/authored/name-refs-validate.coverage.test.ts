import { describe, expect, test } from "bun:test";
import {
  warnUnknownNameRefs,
  warnUnknownNameRefsInPolicy,
  warnUnknownNameRefsInStrings,
} from "../../src/authored/name-refs-validate.ts";
import type { Authored } from "../../src/schema/authored.ts";
import type { ResolvedPolicy } from "../../src/schema/policy.ts";

type WarnCapture = { code: string; message: string; ctx?: Record<string, unknown> }[];

function captureWarn(): { warns: WarnCapture; fn: (code: string, message: string, ctx?: Record<string, unknown>) => void } {
  const warns: WarnCapture = [];
  return {
    warns,
    fn(code, message, ctx) {
      warns.push({ code, message, ctx });
    },
  };
}

function minimalAuthored(over: Partial<Authored> = {}): Authored {
  return {
    characters: {},
    locations: {},
    items: {},
    fields: {},
    knowledge: [],
    templates: { character: {}, scene: {}, location: {} },
    anchors: [],
    beats: [],
    world: { title: "t", language: "en" },
    config: { seed: 1, policies: [] },
    ...over,
  } as Authored;
}

describe("warnUnknownNameRefs extended surfaces", () => {
  test("player name ref is allowed", () => {
    const { warns, fn } = captureWarn();
    const authored = minimalAuthored({
      characters: {
        npc1: {
          id: "npc1",
          origin: "authored",
          persona: "Hi {{name:player}}.",
          card: {
            identity: { name: "Npc", summary: "s" },
            tags: [],
            style: "",
            constraints: { motives: [], taboos: [], bottom_lines: [] },
          },
          traits: { event_mult: {} },
          tracks: { self: {}, toward: {}, overrides: {} },
          goals: [],
          secrets: [],
          relations: [],
          knowledge: [],
        },
      },
    } as unknown as Authored);
    warnUnknownNameRefs(authored, fn);
    expect(warns).toEqual([]);
  });

  test("scans knowledge, locations, templates, and nested policy strings", () => {
    const { warns, fn } = captureWarn();
    const authored = minimalAuthored({
      knowledge: [{ path: "k/a.md", name: "K", body: "See {{name:missing}}.", tags: [] }],
      locations: {
        loc1: { id: "loc1", name: "L", description: "{{name:ghost}}", connects: [] },
      },
      templates: {
        character: { t1: { guidance: "{{name:ghost}}", fields: {}, defaults: {}, lod: "extra" } },
        location: { t2: { guidance: "ok {{name:player}}", fields: {}, defaults: {} } },
        scene: {},
      },
      world: { title: "t", language: "en", rules_text: "{{name:ghost}}" },
    } as unknown as Authored);
    warnUnknownNameRefs(authored, fn);
    expect(warns.filter((w) => w.code === "NAME_REF_UNKNOWN").length).toBeGreaterThanOrEqual(4);
    expect(warns.some((w) => w.message.includes("ghost"))).toBe(true);
  });

  test("warnUnknownNameRefsInPolicy walks x.prompt and event descriptions", () => {
    const { warns, fn } = captureWarn();
    const ids = new Set(["player", "npc1"]);
    const policy = {
      x: { prompt: { intro: "{{name:ghost}}" }, tier_directives: { s2: ["{{name:ghost}}"] } },
      events: { types: { custom: { description: "For {{name:ghost}}" } } },
    } as unknown as ResolvedPolicy;
    warnUnknownNameRefsInPolicy(policy, ids, fn);
    expect(warns.every((w) => w.code === "NAME_REF_UNKNOWN")).toBe(true);
    expect(warns.length).toBe(3);
  });

  test("warnUnknownNameRefsInStrings scans catalog entries", () => {
    const { warns, fn } = captureWarn();
    const ids = new Set(["player"]);
    warnUnknownNameRefsInStrings({ "ui.greet": "Hello {{name:unknown}}" }, ids, fn);
    expect(warns).toHaveLength(1);
    expect(warns[0]?.ctx?.id).toBe("unknown");
  });
});
