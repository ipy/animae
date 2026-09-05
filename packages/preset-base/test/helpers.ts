import type { Catalog } from "../../engine/src/contracts.ts";
import type { Authored, CharacterDef } from "../../engine/src/schema/authored.ts";
import type { ResolvedPolicy } from "../../engine/src/schema/policy.ts";
import type { EngineState } from "../../engine/src/state.ts";
import { loadPolicy, createPresetRegistry } from "../../engine/src/policy/index.ts";
import { MemoryStorage } from "../../engine/src/store/memory.ts";
import presetBase from "../src/index.ts";
import presetDnd from "../../preset-dnd/src/index.ts";

export const registry = createPresetRegistry([presetBase, presetDnd]);

export async function loadBasePolicy(): Promise<ResolvedPolicy> {
  const storage = MemoryStorage();
  await storage.writeAtomic("animae.yaml", 'preset: "@animae/preset-base"\nseed: 1\npolicies: []\n');
  const r = await loadPolicy(storage, { preset: "@animae/preset-base", policies: [], seed: 1 }, registry);
  return r.policy;
}

export async function loadDndPolicy(): Promise<ResolvedPolicy> {
  const storage = MemoryStorage();
  await storage.writeAtomic("animae.yaml", 'preset: "@animae/preset-dnd"\nseed: 1\npolicies: []\n');
  const r = await loadPolicy(storage, { preset: "@animae/preset-dnd", policies: [], seed: 1 }, registry, {
    knownRuleFns: new Set(["dndIntimidationExtra"]),
  });
  return r.policy;
}

export function npcDef(overrides?: Partial<CharacterDef>): CharacterDef {
  return {
    id: "npc",
    origin: "authored",
    card: {
      identity: { id: "npc", name: "Npc", summary: "", style_examples: [] },
      constraints: {
        motives: [],
        bottom_lines: [{ id: "bl1", text: "hard line", tags: ["taboo_x"], hardness: "hard" }],
        taboos: [],
      },
      lod: "principal",
      tags: [],
    },
    persona: "",
    traits: { event_mult: {} },
    tracks: { self: {}, toward: {}, overrides: {} },
    goals: [],
    secrets: [],
    relations: [],
    knowledge: [],
    ...overrides,
  };
}

export function baseState(): EngineState {
  return {
    time: { day: 1, minute: 0 },
    seq: 0,
    vars: {},
    locations: {},
    items: {},
    characters: {
      npc: {
        id: "npc",
        name: "Npc",
        lod: "principal",
        origin: "authored",
        tracks: { self: { mood: 0 }, toward: { player: { affinity: 50, trust: 50 } } },
        tiers: { self: {}, toward: { player: { affinity: "neutral", trust: "neutral" } } },
        vars: {},
        tags: [],
        goals: [],
        claims: [],
        interactions: 0,
        unlockedSecrets: [],
        lastSimulated: { day: 1, minute: 0 },
      },
    },
    fields: {},
    anchors: {},
    beat: { current: null, entered: [] },
    sidenotes: [],
    exceptions: {},
    schedule: {},
    scene: { id: "scn_1", location: "x", participants: ["npc", "player"], turn: 1, startedAt: { day: 1, minute: 0 }, fields: [] },
    sceneCount: 1,
    turnCount: 1,
    counters: {},
    turnAcc: { turn: null, delta: {} },
    windows: {},
    firedThresholds: {},
    grants: [],
    budget: { turns: 0, s2Turns: 0, s2Scene: 0, degraded: [] },
    memoryIndex: {},
    config: { hash: "" },
    generated: { characters: {}, locations: {}, items: {} },
    purged: [],
  };
}

export const authoredStub = {
  config: { seed: 42, policies: [] },
  world: {
    language: "en",
    calendar: { units: { minute: 1, hour: 60, day: 1440 }, sceneMinutes: 30, turnMinutes: 1, chapters: [] },
    public_vars: ["public"],
  },
  fields: {},
  characters: {},
  locations: {},
  items: {},
  templates: {},
  knowledge: {},
  anchors: [],
  schedule: {},
  beats: {},
  secrets: {},
  relations: [],
  hashes: { combined: "", files: {} },
} as unknown as Authored;

export function catalog(def: CharacterDef = npcDef()): Catalog {
  return {
    character(id) {
      return id === def.id ? def : undefined;
    },
    characters: () => [def],
    location: () => undefined,
    locations: () => [],
    item: () => undefined,
    template: () => undefined,
    knowledge: () => [],
  };
}
