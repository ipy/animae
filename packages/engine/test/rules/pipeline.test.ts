import { test, expect } from "bun:test";
import type { Catalog } from "../../src/contracts.ts";
import type { Authored } from "../../src/schema/authored.ts";
import type { ResolvedPolicy } from "../../src/schema/policy.ts";
import type { EngineState } from "../../src/state.ts";
import { createRng } from "../../src/timeline/rng.ts";
import { createCelEngine } from "../../src/rules/cel.ts";
import { createRuleEngine } from "../../src/rules/rule-engine.ts";
import { buildCelContext } from "../../src/rules/cel-context.ts";
import { decideIntent } from "../../src/rules/decide.ts";
import { adjudicate } from "../../src/rules/adjudicate.ts";

const policy: ResolvedPolicy = {
  events: { types: { care: { positive: true }, meta_probe: { positive: false } } },
  tracks: {
    affinity: { scope: "relation", min: 0, max: 100, initial: 50, tiers: [], hysteresis: 0 },
    mood: { scope: "self", min: -100, max: 100, initial: 0, tiers: [], hysteresis: 0 },
  },
  rules: {
    delta_table: { care: { affinity: 4, mood: 10 } },
    marginal: { k: 0.5, halfLifeHours: 24 },
    turn_cap: { affinity: 8, mood: 20 },
    windows: [],
    thresholds: [],
    custom: [],
  },
  intent: { types: ["respond", "refuse"] },
  intent_rules: [
    { intent: "refuse", when: "event.intensity > 0.9", score: 10 },
    { intent: "respond", when: "true", score: 1 },
  ],
  input: {
    response: {
      injection_suspect: { emit: "other", intent: "respond" },
      meta_probe: { emit: "meta_probe", intent: "refuse" },
    },
  },
  memory: {
    k: 8,
    recencyHalfLifeDays: 7,
    indexMax: 50,
    weights: { term: 0.5, recency: 0.2, importance: 0.2, salience: 0.1 },
    write: { episodic: true, minIntensity: 0.2, maxChars: 240 },
    forgetting: { enabled: false, tau: 30, threshold: 0.2 },
    distortion: { enabled: false, p: 0.1, maxImportance: 0.7, kinds: ["intensify"] },
    propagation: { enabled: false, onTick: "day", distortionPerHop: 1 },
  },
  router: { triggers: {}, budget: { syncCallsPerTurn: 2, s2PerTurn: 1, s2Ratio: 0.15, s2ReservedForAnchors: 0.03, maxOutputTokens: { s1: 400, s2: 800 } }, degrade: [] },
  render: { retryOnMismatch: 0, recentTurns: 12 },
  cues: { types: {} },
  choices: { enabled: false, count: 3, filter: "true" },
  timeline: { allowRewind: true, carry: [] },
  visibility: { rules: [] },
  checks: [],
  safety: { enabled: false, response: "in_character", log: false },
  fields: { grants: [{ holder: "true", source: "true", maxLevel: "L4" }], caps: {} },
  reflection: { enabled: true, accept: "!conflict" },
  characters: { lod: { promote: [] } },
  offscreen: { fidelity: { default: "rule", locations: {}, characters: {} } },
  scene: { turnTaking: "addressed", autonomous: { maxExchangesPerPlayerTurn: 0, when: "true" } },
  x: {},
};

function emptyState(): EngineState {
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
        tracks: { self: { mood: 0 }, toward: { player: { affinity: 50 } } },
        tiers: { self: {}, toward: {} },
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
    scene: { id: "scn_0001", location: "x", participants: ["npc", "player"], turn: 1, startedAt: { day: 1, minute: 0 }, fields: [] },
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

const catalog: Catalog = {
  character(id) {
    return id === "npc" ? { id: "npc", name: "Npc", traits: {}, tags: [], vars: {} } as never : undefined;
  },
  characters: () => [],
  location: () => undefined,
  locations: () => [],
  item: () => undefined,
  template: () => undefined,
  knowledge: () => [],
};

const authored = { config: { seed: 0, policies: [] }, world: { language: "en", calendar: { units: { minute: 1, hour: 60, day: 1440 }, sceneMinutes: 30, turnMinutes: 1, chapters: [] } }, fields: {}, characters: {}, locations: {}, items: {}, templates: {}, knowledge: {}, anchors: {}, schedule: {}, beats: {}, secrets: {}, relations: [], hashes: { combined: "", files: {} } } as unknown as Authored;

test("decideIntent tie breaks by declaration order", () => {
  const cel = createCelEngine();
  const rules = createRuleEngine(cel);
  const deps = {
    state: emptyState(),
    authored,
    policy,
    cel,
    rules,
    catalog,
    celContext: buildCelContext({ state: emptyState(), authored, policy, catalog }, { self: "npc", other: "player", actor: "player" }),
  };
  const r = decideIntent(deps, {
    owner: "npc",
    actor: "player",
    appraisal: { type: "care", intensity: 0.5, sincerity: 1, claims: [], search_terms: [], tags: [], input_class: "normal" },
  });
  expect(r.intent).toBe("respond");
});

test("decideIntent input.response override", () => {
  const cel = createCelEngine();
  const rules = createRuleEngine(cel);
  const st = emptyState();
  const deps = { state: st, authored, policy, cel, rules, catalog, celContext: {} };
  const r = decideIntent(deps, {
    owner: "npc",
    actor: "player",
    appraisal: {
      type: "other",
      intensity: 0,
      sincerity: 1,
      claims: [],
      search_terms: [],
      tags: [],
      input_class: "meta_probe",
    },
  });
  expect(r.forced).toBe(true);
  expect(r.emitEventType).toBe("meta_probe");
});

test("adjudicate emits track.delta for care", () => {
  const cel = createCelEngine();
  const rules = createRuleEngine(cel);
  const st = emptyState();
  const deps = {
    state: st,
    authored,
    policy,
    cel,
    rules,
    catalog,
    celContext: buildCelContext({ state: st, authored, policy, catalog }, { self: "npc", other: "player", actor: "player" }),
  };
  const { drafts } = adjudicate(deps, {
    appraisal: { type: "care", intensity: 1, sincerity: 1, claims: [], search_terms: [], tags: [], input_class: "normal" },
    actor: "player",
    owner: "npc",
    turnId: "turn_0001",
    rng: createRng(0, "main", "adj"),
  });
  const td = drafts.find((d) => d.kind === "track.delta" && (d as unknown as { track: string }).track === "affinity");
  expect(td).toBeDefined();
  expect((td as unknown as { delta: number }).delta).toBe(4);
});
