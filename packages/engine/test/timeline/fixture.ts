import type { Authored, CharacterDef } from "../../src/schema/authored.ts";
import type { ResolvedPolicy } from "../../src/schema/policy.ts";
import type { CelEngine } from "../../src/contracts.ts";

export const fakeCel: CelEngine = {
  check: () => undefined,
  eval: <T = unknown>(expr: string) => expr as T,
  bool: (expr) => (typeof expr === "boolean" ? expr : expr === "true"),
  num: (expr) => (typeof expr === "number" ? expr : Number(expr)),
  str: (expr) => String(expr),
};

export function minimalPolicy(overrides?: Partial<ResolvedPolicy>): ResolvedPolicy {
  const base: ResolvedPolicy = {
    events: { types: { chat: { positive: true }, other: { positive: false } } },
    tracks: {
      affinity: { scope: "relation", min: 0, max: 100, initial: 50, tiers: [{ name: "warm", from: 60 }], hysteresis: 5 },
      mood: { scope: "self", min: 0, max: 100, initial: 50, tiers: [], hysteresis: 0 },
    },
    rules: { delta_table: {}, marginal: { k: 0.15, halfLifeHours: 24 }, turn_cap: {} },
    intent: { types: ["talk"] },
    intent_rules: [],
    memory: {},
    appraise: {},
    router: { budget: { syncCallsPerTurn: 2, s2PerTurn: 1, s2Ratio: 0.15, s2ReservedForAnchors: 0.03, maxOutputTokens: { s1: 400, s2: 800 } } },
    render: { retryOnMismatch: 0, recentTurns: 12 },
    cues: { types: {} },
    choices: { enabled: false, count: 3, filter: "true" },
    timeline: { allowRewind: true, carry: [{ characters: "*", kinds: ["track", "world_var"], tags: [], when: "true" }] },
    visibility: { rules: [] },
    checks: [],
    input: { response: { injection_suspect: { intent: "deflect" }, meta_probe: { intent: "deflect" } } },
    safety: { enabled: false, response: "in_character", log: false },
    fields: { caps: {} },
    reflection: { enabled: true, accept: "true" },
    offscreen: { fidelity: { default: "rule", locations: {}, characters: {} } },
    scene: { autonomous: { maxExchangesPerPlayerTurn: 0, when: "true" } },
    characters: { lod: { promote: [] } },
  };
  return { ...base, ...overrides, tracks: { ...base.tracks, ...overrides?.tracks } };
}

const npc: CharacterDef = {
  id: "npc1",
  origin: "authored",
  card: {
    identity: { name: "Npc One", summary: "", style_examples: [] },
    constraints: { motives: [], bottom_lines: [], taboos: [] },
    lod: "principal",
    tags: [],
  },
  persona: "",
  traits: { event_mult: {} },
  tracks: { self: { mood: 40 }, toward: { "*": { affinity: 55 }, player: { affinity: 55 } }, overrides: {} },
  goals: [],
  secrets: [],
  relations: [{ to: "player", kind: "friend", tracks: { affinity: 55 }, share: "false" }],
  knowledge: [],
};

export function minimalAuthored(): Authored {
  return {
    config: { seed: 42, policies: [] },
    world: {
      language: "en",
      calendar: { units: { minute: 1, hour: 60, day: 1440 }, sceneMinutes: 30, turnMinutes: 1, chapters: [] },
      start: { day: 1, minute: 480 },
      vars: { gold: 10 },
      public_vars: [],
      factions: {},
      player: "player",
      start_location: "tavern",
    },
    locations: { tavern: { id: "tavern", name: "Tavern", summary: "", tags: [], connects: [], vars: {} } },
    items: {},
    fields: {},
    anchors: [],
    beats: [],
    exceptions: {},
    schedule: [],
    decks: [],
    knowledge: [],
    characters: { npc1: npc },
    templates: { character: {}, location: {}, item: {} },
    hash: "testhash",
    files: { "animae.yaml": "abc", "world/world.yaml": "def" },
  };
}
