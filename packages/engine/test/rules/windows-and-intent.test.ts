import { describe, expect, test } from "bun:test";
import type { Catalog } from "../../src/contracts.ts";
import type { Appraisal } from "../../src/events.ts";
import { adjudicate } from "../../src/rules/adjudicate.ts";
import { buildCelContext } from "../../src/rules/cel-context.ts";
import { createCelEngine } from "../../src/rules/cel.ts";
import { decideIntent } from "../../src/rules/decide.ts";
import type { RulesDeps } from "../../src/rules/deps.ts";
import { createRuleEngine } from "../../src/rules/rule-engine.ts";
import type { Authored, FieldEffects } from "../../src/schema/authored.ts";
import type { ResolvedPolicy } from "../../src/schema/policy.ts";
import type { EngineState } from "../../src/state.ts";
import { createRng } from "../../src/timeline/rng.ts";
import { minimalAuthored, openPolicy } from "../helpers/fake-kernel.ts";

type Window = NonNullable<ResolvedPolicy["rules"]["windows"]>[number];

function policyWith(windows: Window[]): ResolvedPolicy {
  const base = openPolicy();
  return {
    ...base,
    events: { types: { care: { positive: true }, insult: { positive: false } } },
    tracks: {
      affinity: { scope: "relation", min: 0, max: 100, initial: 50, tiers: [], hysteresis: 0 },
      mood: { scope: "self", min: -100, max: 100, initial: 0, tiers: [], hysteresis: 0 },
    },
    rules: {
      ...base.rules,
      delta_table: { care: { affinity: 4, mood: 10 }, insult: { affinity: -4 } },
      marginal: { k: 0.5, halfLifeHours: 24 },
      turn_cap: {},
      windows,
      thresholds: [],
      custom: [],
    },
    intent: { types: ["respond", "refuse"] },
    intent_rules: [
      { intent: "refuse", when: "event.intensity > 0.9", score: 10 },
      { intent: "respond", when: "true", score: 1 },
    ],
  };
}

function stateWith(windows: EngineState["windows"] = {}, sceneCount = 1): EngineState {
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
    sceneCount,
    turnCount: 1,
    counters: {},
    turnAcc: { turn: null, delta: {} },
    windows,
    firedThresholds: {},
    grants: [],
    budget: { turns: 0, s2Turns: 0, s2Scene: 0, degraded: [] },
    memoryIndex: {},
    config: { hash: "" },
    generated: { characters: {}, locations: {}, items: {} },
    purged: [],
  } as EngineState;
}

const catalog = {
  character: (id: string) => (id === "npc" ? { id: "npc", name: "Npc", traits: {}, tags: [], vars: {} } : undefined),
  characters: () => [],
  location: () => undefined,
  locations: () => [],
  item: () => undefined,
  template: () => undefined,
  knowledge: () => [],
} as unknown as Catalog;

const authored = minimalAuthored() as unknown as Authored;

function depsFor(policy: ResolvedPolicy, state: EngineState): RulesDeps {
  const cel = createCelEngine();
  return {
    state,
    authored,
    policy,
    cel,
    rules: createRuleEngine(cel),
    catalog,
    celContext: buildCelContext({ state, authored, policy, catalog }, { self: "npc", other: "player", actor: "player" }),
  };
}

const appraisal = (type: string, intensity = 1): Appraisal => ({
  type,
  intensity,
  sincerity: 1,
  claims: [],
  search_terms: [],
  tags: [],
  input_class: "normal",
});

type Draft = { kind: string } & Record<string, unknown>;

function play(windows: Window[], open: EngineState["windows"], opts: { type?: string; intensity?: number; sceneCount?: number } = {}): Draft[] {
  const state = stateWith(open, opts.sceneCount ?? 1);
  return adjudicate(depsFor(policyWith(windows), state), {
    appraisal: appraisal(opts.type ?? "care", opts.intensity ?? 1),
    actor: "player",
    owner: "npc",
    turnId: "turn_0001",
    rng: createRng(0, "main", "adj"),
  }).drafts as unknown as Draft[];
}

const deltaOf = (drafts: Draft[], track: string): number | undefined =>
  drafts.find((d) => d.kind === "track.delta" && d.track === track)?.delta as number | undefined;

const warm = (over: Partial<Window> = {}): Window => ({
  id: "warm",
  trigger: "true",
  durationScenes: 2,
  mult: { affinity: 1.5 },
  capToLoss: false,
  ...over,
});

describe("rule windows", () => {
  test("a window opens when its trigger holds, for the owner and target of the turn, and runs for durationScenes", () => {
    const opened = play([warm()], {}).filter((d) => d.kind === "rule.window_opened");
    expect(opened).toEqual([{ kind: "rule.window_opened", id: "warm", owner: "npc", target: "player", untilScene: 3, durationScenes: 2 }]);
  });

  test("the trigger is a CEL expression over the turn", () => {
    const calm = warm({ trigger: "event.intensity > 0.5" });
    expect(play([calm], {}, { intensity: 0.2 }).some((d) => d.kind === "rule.window_opened")).toBe(false);
    expect(play([calm], {}, { intensity: 0.9 }).some((d) => d.kind === "rule.window_opened")).toBe(true);
  });

  test("an open window is not opened again, but is once its scenes have passed", () => {
    const open = { warm: { untilScene: 3, owner: "npc", target: "player" } };
    expect(play([warm()], open, { sceneCount: 1 }).some((d) => d.kind === "rule.window_opened")).toBe(false);
    expect(play([warm()], open, { sceneCount: 3 }).some((d) => d.kind === "rule.window_opened")).toBe(false);
    const again = play([warm()], open, { sceneCount: 4 }).filter((d) => d.kind === "rule.window_opened");
    expect(again).toMatchObject([{ id: "warm", untilScene: 6 }]);
  });

  test("while open it scales the deltas of the tracks it names and leaves the others alone", () => {
    const open = { warm: { untilScene: 3, owner: "npc", target: "player" } };
    expect(deltaOf(play([], {}), "affinity")).toBe(4);
    expect(deltaOf(play([warm()], open), "affinity")).toBe(6);
    expect(deltaOf(play([warm()], open), "mood")).toBe(10);
  });

  test("it applies for the owner and target it was opened for, and only until its last scene", () => {
    const other = { warm: { untilScene: 3, owner: "npc", target: "someone-else" } };
    expect(deltaOf(play([warm()], other), "affinity")).toBe(4);
    const elsewhere = { warm: { untilScene: 3, owner: "ghost", target: "player" } };
    expect(deltaOf(play([warm()], elsewhere), "affinity")).toBe(4);
    const lapsed = { warm: { untilScene: 3, owner: "npc", target: "player" } };
    expect(deltaOf(play([warm()], lapsed, { sceneCount: 3 }), "affinity")).toBe(6);
    expect(deltaOf(play([warm()], lapsed, { sceneCount: 4 }), "affinity")).toBe(4);
  });

  test("capToLoss drops every gain while open and lets losses through", () => {
    const open = { warm: { untilScene: 3, owner: "npc", target: "player" } };
    const guarded = warm({ capToLoss: true, mult: { affinity: 1 } });
    expect(deltaOf(play([guarded], open), "affinity")).toBeUndefined();
    expect(deltaOf(play([guarded], open, { type: "insult" }), "affinity")).toBe(-4);
    // a gain that arrives with no window open is not touched
    expect(deltaOf(play([guarded], {}), "affinity")).toBe(4);
  });
});

describe("decideIntent with field effects", () => {
  const decide = (fieldEffects?: FieldEffects, intensity = 0.5) =>
    decideIntent(depsFor(policyWith([]), stateWith()), { owner: "npc", actor: "player", appraisal: appraisal("care", intensity), fieldEffects });

  test("without effects the highest-scoring rule wins", () => {
    expect(decide().intent).toBe("respond");
    expect(decide(undefined, 0.95).intent).toBe("refuse");
  });

  test("a forced intent beats every score", () => {
    const forced = decide({ intent_force: "refuse" });
    expect(forced).toMatchObject({ intent: "refuse", forced: true });
    expect(forced.scores.refuse).toBe(Infinity);
  });

  test("a bias is added to the score of the intent it names, and can turn the decision", () => {
    expect(decide({ intent_bias: { refuse: 5 } }).intent).toBe("refuse");
    const faint = decide({ intent_bias: { respond: 1 } });
    expect(faint.intent).toBe("respond");
    expect(faint.scores.respond).toBe(2);
  });

  test("a forbidden intent is passed over for the next best one", () => {
    expect(decide({ intent_forbid: ["refuse"] }, 0.95).intent).toBe("respond");
  });

  test("when every scored intent is forbidden, the first allowed intent type answers", () => {
    expect(decide({ intent_forbid: ["respond"] }).intent).toBe("refuse");
  });
});
