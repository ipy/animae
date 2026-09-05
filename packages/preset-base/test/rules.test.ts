import { test, expect, describe } from "bun:test";
import { createCelEngine } from "../../engine/src/rules/cel.ts";
import { createRuleEngine } from "../../engine/src/rules/rule-engine.ts";
import { adjudicate } from "../../engine/src/rules/adjudicate.ts";
import { decideIntent } from "../../engine/src/rules/decide.ts";
import { marginal, tierFor, decayStep } from "../../engine/src/rules/primitives.ts";
import { createRng } from "../../engine/src/timeline/rng.ts";
import { authoredStub, baseState, catalog, loadBasePolicy, npcDef } from "./helpers.ts";

const EVENT_DELTAS: Record<string, { affinity: number; trust: number; mood: number }> = {
  care: { affinity: 4, trust: 2, mood: 10 },
  praise: { affinity: 3, trust: 0, mood: 8 },
  gift: { affinity: 4, trust: 1, mood: 10 },
  request: { affinity: 0, trust: 0, mood: 0 },
  promise_kept: { affinity: 2, trust: 6, mood: 5 },
  disclosure: { affinity: 2, trust: 5, mood: 5 },
  smalltalk: { affinity: 1, trust: 0, mood: 2 },
  lie_exposed: { affinity: -4, trust: -8, mood: -15 },
  insincere_speech: { affinity: 0, trust: -3, mood: -5 },
  boundary_push: { affinity: -4, trust: -4, mood: -15 },
  insult: { affinity: -6, trust: -3, mood: -20 },
  apology: { affinity: 1, trust: 2, mood: 5 },
  promise_broken: { affinity: -3, trust: -8, mood: -10 },
  shared_experience: { affinity: 3, trust: 3, mood: 8 },
  meta_probe: { affinity: 0, trust: -1, mood: -3 },
  other: { affinity: 0, trust: 0, mood: 0 },
};

describe("preset-base adjudicate deltas", () => {
  for (const [type, expected] of Object.entries(EVENT_DELTAS)) {
    test(`${type} at intensity 1 / sincerity 1 / n=0`, async () => {
      const policy = await loadBasePolicy();
      const cel = createCelEngine();
      const rules = createRuleEngine(cel);
      const state = baseState();
      const deps = {
        state,
        authored: authoredStub,
        policy,
        cel,
        rules,
        catalog: catalog(),
        celContext: {},
      };
      const { drafts } = adjudicate(deps, {
        appraisal: { type, intensity: 1, sincerity: 1, claims: [], search_terms: [], tags: [], input_class: "normal" },
        actor: "player",
        owner: "npc",
        turnId: "turn_1",
        rng: createRng(1, "main", "t"),
      });
      for (const [track, delta] of Object.entries(expected)) {
        if (delta === 0) {
          expect(drafts.some((d) => d.kind === "track.delta" && (d as unknown as { track: string }).track === track)).toBe(false);
        } else {
          const td = drafts.find((d) => d.kind === "track.delta" && (d as unknown as { track: string }).track === track);
          expect(td).toBeDefined();
          expect((td as unknown as { delta: number }).delta).toBe(delta);
        }
      }
    });
  }

  test("sincerity scales positive bases only", async () => {
    const policy = await loadBasePolicy();
    const cel = createCelEngine();
    const rules = createRuleEngine(cel);
    const deps = { state: baseState(), authored: authoredStub, policy, cel, rules, catalog: catalog(), celContext: {} };
    const { drafts } = adjudicate(deps, {
      appraisal: { type: "care", intensity: 1, sincerity: 0.5, claims: [], search_terms: [], tags: [], input_class: "normal" },
      actor: "player",
      owner: "npc",
      turnId: "turn_1",
      rng: createRng(1, "main", "t"),
    });
    expect(drafts.find((d) => (d as unknown as { track: string }).track === "affinity")?.delta).toBe(2);
    expect(drafts.find((d) => (d as unknown as { track: string }).track === "trust")?.delta).toBe(1);
    expect(drafts.find((d) => (d as unknown as { track: string }).track === "mood")?.delta).toBe(5);
  });

  test("marginal decay k=0.5", () => {
    expect(marginal(0, 0.5)).toBe(1);
    expect(marginal(1, 0.5)).toBeCloseTo(2 / 3, 5);
  });

  test("turn caps affinity 8", async () => {
    const policy = await loadBasePolicy();
    const cel = createCelEngine();
    const rules = createRuleEngine(cel);
    const state = baseState();
    state.turnAcc = { turn: "turn_1", delta: { affinity: 6 } };
    const deps = { state, authored: authoredStub, policy, cel, rules, catalog: catalog(), celContext: {} };
    const { drafts } = adjudicate(deps, {
      appraisal: { type: "care", intensity: 1, sincerity: 1, claims: [], search_terms: [], tags: [], input_class: "normal" },
      actor: "player",
      owner: "npc",
      turnId: "turn_1",
      rng: createRng(1, "main", "t"),
    });
    expect(drafts.find((d) => (d as unknown as { track: string }).track === "affinity")?.delta).toBe(2);
  });
});

describe("tiers and mood", () => {
  test("affinity tier boundaries with hysteresis ±3", async () => {
    const policy = await loadBasePolicy();
    const tiers = policy.tracks.affinity!.tiers;
    expect(tierFor(39, tiers, "neutral", 3).tier).toBe("neutral");
    expect(tierFor(63, tiers, "neutral", 3).tier).toBe("close");
    expect(tierFor(62, tiers, "neutral", 3).tier).toBe("neutral");
  });

  test("mood hourly decay 10% toward 0", () => {
    const cfg = { toward: 0, ratePerHour: 0.1 };
    expect(decayStep(50, cfg, 1)).toBeCloseTo(45, 5);
    expect(decayStep(-40, cfg, 1)).toBeCloseTo(-36, 5);
  });
});

describe("intent rules", () => {
  test("refuse on hard bottom line tag intersection", async () => {
    const policy = await loadBasePolicy();
    const cel = createCelEngine();
    const rules = createRuleEngine(cel);
    const def = npcDef();
    const deps = {
      state: baseState(),
      authored: authoredStub,
      policy,
      cel,
      rules,
      catalog: catalog(def),
      celContext: {},
    };
    const r = decideIntent(deps, {
      owner: "npc",
      actor: "player",
      appraisal: { type: "care", intensity: 1, sincerity: 1, claims: [], search_terms: [], tags: ["taboo_x"], input_class: "normal" },
    });
    expect(r.intent).toBe("refuse");
  });

  test("negotiate beats comply when trust<40 on request", async () => {
    const policy = await loadBasePolicy();
    const cel = createCelEngine();
    const rules = createRuleEngine(cel);
    const state = baseState();
    state.characters.npc!.tracks.toward.player!.trust = 30;
    const deps = { state, authored: authoredStub, policy, cel, rules, catalog: catalog(), celContext: {} };
    const r = decideIntent(deps, {
      owner: "npc",
      actor: "player",
      appraisal: { type: "request", intensity: 1, sincerity: 1, claims: [], search_terms: [], tags: [], input_class: "normal" },
    });
    expect(r.intent).toBe("negotiate");
  });

  test("input.response mapping", async () => {
    const policy = await loadBasePolicy();
    const cel = createCelEngine();
    const rules = createRuleEngine(cel);
    const deps = { state: baseState(), authored: authoredStub, policy, cel, rules, catalog: catalog(), celContext: {} };
    const inj = decideIntent(deps, {
      owner: "npc",
      actor: "player",
      appraisal: { type: "other", intensity: 0, sincerity: 1, claims: [], search_terms: [], tags: [], input_class: "injection_suspect" },
    });
    expect(inj.intent).toBe("deflect");
    expect(inj.emitEventType).toBe("insincere_speech");
    const meta = decideIntent(deps, {
      owner: "npc",
      actor: "player",
      appraisal: { type: "other", intensity: 0, sincerity: 1, claims: [], search_terms: [], tags: [], input_class: "meta_probe" },
    });
    expect(meta.intent).toBe("deflect");
    expect(meta.emitEventType).toBe("meta_probe");
  });
});
