import { test, expect, describe } from "bun:test";
import { createRouter } from "../../src/router/router.ts";
import { detectContradiction } from "../../src/router/contradiction.ts";
import { evaluateTriggers, isAmbiguous } from "../../src/router/triggers.ts";
import { createPipelineKernel, charDef } from "../pipeline/test-kernel.ts";
import { applyPolicyDefaults } from "../../src/policy/defaults.ts";
import type { Appraisal } from "../../src/events.ts";
import type { RouteInput } from "../../src/contracts.ts";
import { testRouterBudget, testBudgetState } from "../helpers/policy-fixtures.ts";
import { createScriptedModel } from "../../src/model/scripted.ts";
import { createTierResolver } from "../../src/model/tier-resolver.ts";
import type { Kernel } from "../../src/contracts.ts";
import type { RuntimeMode } from "../../src/runtime/types.ts";

const baseAppraisal: Appraisal = {
  type: "chat",
  intensity: 0.5,
  sincerity: 0.8,
  claims: [],
  search_terms: [],
  tags: [],
  input_class: "normal",
};

function routeInput(over: Partial<RouteInput> = {}): RouteInput {
  return {
    turn: { turnId: "turn_0001", sceneId: "scn_0001", actor: "player", addressee: "npc1", speaker: "npc1", text: "hi", autonomous: false },
    appraisal: baseAppraisal,
    anchorNear: false,
    fieldMaxLevel: 0,
    tierChanged: false,
    sidenoteReceived: false,
    sceneFirstTurn: false,
    secretTopic: false,
    contradiction: false,
    autonomous: false,
    ...over,
  };
}

describe("router triggers", () => {
  test("evaluateTriggers collects enabled reasons sorted", () => {
    const policy = applyPolicyDefaults({
      router: { triggers: { scene_first: { enabled: true }, field_high: { enabled: true } } },
      events: { types: { chat: { positive: true } } },
    });
    const reasons = evaluateTriggers(routeInput({ sceneFirstTurn: true, fieldMaxLevel: 2 }), policy);
    expect(reasons).toEqual(["field_high", "scene_first"]);
  });

  test("ambiguity: other type", () => {
    const policy = applyPolicyDefaults({ events: { types: { chat: { positive: true } } } });
    expect(isAmbiguous({ ...baseAppraisal, type: "other" }, policy)).toBe(true);
  });

  test("ambiguity: low sincerity on positive event", () => {
    const policy = applyPolicyDefaults({ events: { types: { care: { positive: true } } } });
    expect(isAmbiguous({ ...baseAppraisal, type: "care", sincerity: 0.1 }, policy)).toBe(true);
  });

  test("ambiguity: injection_suspect without insincere_speech", () => {
    const policy = applyPolicyDefaults({ events: { types: { chat: { positive: false } } } });
    expect(
      isAmbiguous({ ...baseAppraisal, type: "chat", input_class: "injection_suspect" }, policy),
    ).toBe(true);
    expect(
      isAmbiguous({ ...baseAppraisal, type: "insincere_speech", input_class: "injection_suspect" }, policy),
    ).toBe(false);
  });

  test("all trigger flags when enabled", () => {
    const policy = applyPolicyDefaults({
      router: {
        triggers: {
          anchor_near: { enabled: true, n: 1 },
          secret_topic: { enabled: true },
          mood_spike: { enabled: true, a: 10, b: 50, track: "mood" },
          tier_change: { enabled: true },
          contradiction: { enabled: true },
          ambiguity: { enabled: true },
          field_high: { enabled: true },
          sidenote: { enabled: true },
          scene_first: { enabled: true },
        },
      },
      events: { types: { other: { positive: false } } },
    });
    const reasons = evaluateTriggers(
      routeInput({
        anchorNear: true,
        secretTopic: true,
        moodDelta: 15,
        tierChanged: true,
        contradiction: true,
        fieldMaxLevel: 3,
        sidenoteReceived: true,
        sceneFirstTurn: true,
        appraisal: { ...baseAppraisal, type: "other" },
      }),
      policy,
    );
    expect(reasons).toEqual([
      "ambiguity",
      "anchor_near",
      "contradiction",
      "field_high",
      "mood_spike",
      "scene_first",
      "secret_topic",
      "sidenote",
      "tier_change",
    ]);
  });
});

describe("detectContradiction", () => {
  test("memory and state claims with same s,p different o", async () => {
    const { k, setState } = createPipelineKernel();
    setState({
      ...k.timeline.state(),
      characters: {
        ...k.timeline.state().characters,
        npc1: {
          ...k.timeline.state().characters.npc1!,
          claims: [{ s: "door", p: "is", o: "open" }],
        },
      },
    });
    expect(detectContradiction(k, "npc1", [{ s: "door", p: "is", o: "locked" }])).toBe(true);
    expect(detectContradiction(k, "npc1", [{ s: "door", p: "is", o: "open" }])).toBe(false);
  });
});

const LLM_MODE: RuntimeMode = { appraise: "llm", render: "llm" };
const RULE_MODE: RuntimeMode = { appraise: "rule", render: "rule" };

const scriptedTier = (id: string) => ({ id, port: createScriptedModel(`scripted/${id}`, () => ({})) });

/** A kernel whose S2 role has two tiers: `standard` (default) and `pro` (the escalation tier). */
function tieredKernel(policy: NonNullable<Parameters<typeof createPipelineKernel>[0]>["policy"]) {
  const made = createPipelineKernel({ policy });
  const standard = scriptedTier("standard");
  const pro = scriptedTier("pro");
  made.k.models.tiers = createTierResolver([standard, pro], { default: "standard", routing: { escalate_to: "pro" } });
  made.k.models.s2 = standard.port;
  return made;
}

/** An escalated render of a previous turn, as the router recorded it. */
function escalatedRoute(scene = "scn_0001", turn = "turn_0000") {
  return {
    kind: "route.decided",
    scene,
    turn,
    appraise: { backend: "llm", slot: "s1", model: "scripted/s1" },
    render: { backend: "llm", slot: "s2", tier: "pro", model: "scripted/pro" },
    triggers: ["scene_first"],
    escalated: true,
    budget: { s1Calls: 1, s2CallsByTier: { pro: 1 } },
  };
}

const chatEvents = { events: { types: { chat: { positive: false } } } };

describe("router tiers", () => {
  test("a trigger escalates the render to the escalation tier", () => {
    const { k } = tieredKernel({
      router: { budget: { ...testRouterBudget, s2Ratio: 1 }, triggers: { scene_first: { enabled: true } } },
      ...chatEvents,
    });
    const { decision, events } = createRouter(k).decide(routeInput({ sceneFirstTurn: true, mode: LLM_MODE }));
    expect(decision.render).toMatchObject({ backend: "llm", slot: "s2", tier: "pro", model: "scripted/pro" });
    expect(decision.escalated).toBe(true);
    expect(decision.triggers).toEqual(["scene_first"]);
    const route = events.find((e) => e.kind === "route.decided") as unknown as Record<string, unknown>;
    expect(route.escalated).toBe(true);
    expect(route.budget).toEqual({ s1Calls: 1, s2CallsByTier: { pro: 1 } });
  });

  test("without a trigger the render stays on the default tier", () => {
    const { k } = tieredKernel({ router: { budget: { ...testRouterBudget, s2Ratio: 1 } }, ...chatEvents });
    const { decision } = createRouter(k).decide(routeInput({ mode: LLM_MODE }));
    expect(decision.render).toMatchObject({ backend: "llm", tier: "standard" });
    expect(decision.escalated).toBe(false);
    expect(decision.triggers).toEqual([]);
  });

  test("no tier above the default: a trigger changes nothing", () => {
    const { k } = createPipelineKernel({
      policy: { router: { triggers: { scene_first: { enabled: true } } }, ...chatEvents },
    });
    const { decision } = createRouter(k).decide(routeInput({ sceneFirstTurn: true, mode: LLM_MODE }));
    expect(decision.render).toMatchObject({ backend: "llm", tier: "only" });
    expect(decision.escalated).toBe(false);
    expect(decision.triggers).toEqual(["scene_first"]);
  });

  test("rule mode decides rule bindings and spends no calls", () => {
    const { k } = tieredKernel({ router: { triggers: { scene_first: { enabled: true } } }, ...chatEvents });
    const { decision, events } = createRouter(k).decide(routeInput({ sceneFirstTurn: true, mode: RULE_MODE }));
    expect(decision.appraise).toEqual({ backend: "rule" });
    expect(decision.render).toEqual({ backend: "rule" });
    expect(decision.escalated).toBe(false);
    const route = events.find((e) => e.kind === "route.decided") as unknown as { budget: unknown };
    expect(route.budget).toEqual({ s1Calls: 0, s2CallsByTier: {} });
  });
});

describe("router budget", () => {
  test("scene pool exhausted: the render tiers down and says so", async () => {
    const { k } = tieredKernel({
      router: {
        budget: { ...testRouterBudget, s2Ratio: 1, sceneS2Pool: 1, s2ReservedForAnchors: 0 },
        degrade: ["s2_tier_down"],
        triggers: { scene_first: { enabled: true } },
      },
      ...chatEvents,
    });
    await k.timeline.append([escalatedRoute()] as never);
    const { decision, events } = createRouter(k).decide(routeInput({ sceneFirstTurn: true, mode: LLM_MODE }));
    expect(decision.render).toMatchObject({ backend: "llm", tier: "standard" });
    expect(decision.escalated).toBe(false);
    expect(decision.degraded).toContain("s2_tier_down");
    const degraded = events.find((e) => e.kind === "budget.degraded") as unknown as { from: string; to: string; reason: string };
    expect(degraded).toMatchObject({ from: "pro", to: "standard", reason: "sceneS2Pool_general" });
  });

  test("actions the plan already applied head the decision's degraded list and the route.decided event", async () => {
    const { k } = tieredKernel({
      router: {
        budget: { ...testRouterBudget, s2Ratio: 1, sceneS2Pool: 1, s2ReservedForAnchors: 0 },
        degrade: ["s2_tier_down"],
        triggers: { scene_first: { enabled: true } },
      },
      ...chatEvents,
    });
    await k.timeline.append([escalatedRoute()] as never);
    const { decision, events } = createRouter(k).decide(
      routeInput({ sceneFirstTurn: true, mode: LLM_MODE, planned: ["s1_to_rule"] }),
    );
    expect(decision.degraded).toEqual(["s1_to_rule", "s2_tier_down"]);
    const route = events.find((e) => e.kind === "route.decided") as unknown as { degraded?: string[] };
    expect(route.degraded).toEqual(["s1_to_rule", "s2_tier_down"]);

    // Nothing planned and nothing degraded at decision time: the field is absent.
    const quiet = createRouter(k).decide(routeInput({ mode: LLM_MODE }));
    expect(quiet.decision.degraded).toEqual([]);
    expect((quiet.events.find((e) => e.kind === "route.decided") as unknown as { degraded?: string[] }).degraded).toBeUndefined();
  });

  test("anchor_near may use the reserved part of the pool", async () => {
    const { k } = tieredKernel({
      router: {
        budget: { ...testRouterBudget, s2Ratio: 1, sceneS2Pool: 2, s2ReservedForAnchors: 0.5 },
        degrade: ["s2_tier_down"],
        triggers: { anchor_near: { enabled: true, n: 1 } },
      },
      ...chatEvents,
    });
    await k.timeline.append([escalatedRoute()] as never);
    const { decision } = createRouter(k).decide(routeInput({ anchorNear: true, mode: LLM_MODE }));
    expect(decision.render).toMatchObject({ backend: "llm", tier: "pro" });
    expect(decision.escalated).toBe(true);
  });

  test("s2Ratio exhausted: tier down", () => {
    const { k, setState } = tieredKernel({
      router: {
        budget: { ...testRouterBudget, s2PerTurn: 2, s2Ratio: 0.1, sceneS2Pool: 10, s2ReservedForAnchors: 0 },
        degrade: ["s2_tier_down"],
        triggers: { scene_first: { enabled: true } },
      },
      ...chatEvents,
    });
    setState({ ...k.timeline.state(), budget: { ...testBudgetState, turns: 10, s2Turns: 5, escalated: 5 } });
    const { decision } = createRouter(k).decide(routeInput({ sceneFirstTurn: true, mode: LLM_MODE }));
    expect(decision.render).toMatchObject({ backend: "llm", tier: "standard" });
    expect(decision.degraded).toContain("s2_tier_down");
  });

  test("s2_to_rule first in the degrade list: the render falls to the rule backend", async () => {
    const { k } = tieredKernel({
      router: {
        budget: { ...testRouterBudget, s2Ratio: 1, sceneS2Pool: 1, s2ReservedForAnchors: 0 },
        degrade: ["s2_to_rule"],
        triggers: { scene_first: { enabled: true } },
      },
      ...chatEvents,
    });
    await k.timeline.append([escalatedRoute()] as never);
    const { decision, events } = createRouter(k).decide(routeInput({ sceneFirstTurn: true, mode: LLM_MODE }));
    expect(decision.render).toEqual({ backend: "rule" });
    const degraded = events.find((e) => e.kind === "budget.degraded") as unknown as { from: string; to: string };
    expect(degraded).toMatchObject({ from: "pro", to: "rule" });
  });

  test("defer_reflection holds reflection back while the escalation budget blocks", () => {
    const { k } = tieredKernel({
      router: {
        budget: { ...testRouterBudget, s2Ratio: 1, sceneS2Pool: 0, s2ReservedForAnchors: 0 },
        degrade: ["defer_reflection", "s2_tier_down"],
        triggers: { scene_first: { enabled: true } },
      },
      ...chatEvents,
    });
    const router = createRouter(k);
    router.decide(routeInput({ sceneFirstTurn: true, mode: LLM_MODE }));
    expect(router.allow("reflection").ok).toBe(false);
    expect(router.allow("reflection").events[0]?.kind).toBe("budget.degraded");
  });

  test("skip_autonomous denies autonomous exchanges while the budget blocks", () => {
    const { k } = tieredKernel({
      router: {
        budget: { ...testRouterBudget, s2Ratio: 1, sceneS2Pool: 0, s2ReservedForAnchors: 0 },
        degrade: ["skip_autonomous", "s2_tier_down"],
        triggers: { scene_first: { enabled: true } },
      },
      ...chatEvents,
    });
    const router = createRouter(k);
    router.decide(routeInput({ sceneFirstTurn: true, mode: LLM_MODE }));
    expect(router.allow("autonomous").ok).toBe(false);
  });

  test("a side job on a tier above the default draws on the escalation budget", () => {
    const { k } = createPipelineKernel({
      policy: {
        router: { budget: { ...testRouterBudget, s2Ratio: 1, sceneS2Pool: 0, s2ReservedForAnchors: 0 }, degrade: ["s2_tier_down"] },
        ...chatEvents,
      },
    });
    const standard = scriptedTier("standard");
    const pro = scriptedTier("pro");
    k.models.tiers = createTierResolver([standard, pro], {
      default: "standard",
      routing: { escalate_to: "pro", offscreen: "pro" },
    });
    k.models.s2 = standard.port;
    const allow = createRouter(k).allow("offscreen_narrate");
    expect(allow.ok).toBe(true);
    expect(allow.tier).toBe("standard");
    expect(allow.events[0]).toMatchObject({ kind: "budget.degraded", action: "s2_tier_down", from: "pro", to: "standard" });
  });
});

describe("router plan", () => {
  const plan = (k: Kernel, mode: RuntimeMode = LLM_MODE) =>
    createRouter(k).plan({ turn: routeInput().turn, mode });

  test("within budget the mode is unchanged and nothing is emitted", () => {
    const { k } = tieredKernel({ router: { budget: { ...testRouterBudget } }, ...chatEvents });
    const p = plan(k);
    expect(p.mode).toEqual({ appraise: "llm", render: "llm", s2Tier: "standard" });
    expect(p.events).toEqual([]);
  });

  test("s2PerTurn 0 on the default tier: the render falls to rule", () => {
    const { k } = tieredKernel({ router: { budget: { ...testRouterBudget, s2PerTurn: 0 }, degrade: ["s2_to_rule"] }, ...chatEvents });
    const p = plan(k);
    expect(p.mode.render).toBe("rule");
    expect(p.mode.appraise).toBe("llm");
    expect(p.events[0]).toMatchObject({ kind: "budget.degraded", action: "s2_to_rule", to: "rule" });
  });

  test("per-tier cap: a tier capped at zero tiers down when the list allows it", () => {
    const { k } = tieredKernel({
      router: { budget: { ...testRouterBudget, s2PerTurnByTier: { standard: 1, pro: 0 } } },
      ...chatEvents,
    });
    const p = createRouter(k).plan({ turn: routeInput().turn, mode: { appraise: "llm", render: "llm", s2Tier: "pro" } });
    expect(p.mode).toEqual({ appraise: "llm", render: "llm", s2Tier: "standard" });
    expect(p.events[0]).toMatchObject({ action: "s2_tier_down", from: "pro", to: "standard" });
  });

  test("s1PerTurn 0: the S1 role falls to rule", () => {
    const { k } = tieredKernel({ router: { budget: { ...testRouterBudget, s1PerTurn: 0 } }, ...chatEvents });
    const p = plan(k);
    expect(p.mode.appraise).toBe("rule");
    expect(p.events[0]).toMatchObject({ action: "s1_to_rule", from: "llm", to: "rule" });
  });

  test("syncCallsPerTurn 1: the degrade order decides which role gives way", () => {
    const render = tieredKernel({
      router: { budget: { ...testRouterBudget, syncCallsPerTurn: 1 }, degrade: ["s2_to_rule", "s1_to_rule"] },
      ...chatEvents,
    });
    expect(plan(render.k).mode).toEqual({ appraise: "llm", render: "rule" });
    const appraise = tieredKernel({
      router: { budget: { ...testRouterBudget, syncCallsPerTurn: 1 }, degrade: ["s1_to_rule", "s2_to_rule"] },
      ...chatEvents,
    });
    expect(plan(appraise.k).mode).toEqual({ appraise: "rule", render: "llm", s2Tier: "standard" });
  });

  test("a rule mode is left as it is: no degrade action is reported for a role already on rule", () => {
    const { k } = tieredKernel({ router: { budget: { ...testRouterBudget, s2PerTurn: 0, s1PerTurn: 0 } }, ...chatEvents });
    const p = plan(k, RULE_MODE);
    expect(p.mode).toEqual(RULE_MODE);
    expect(p.events).toEqual([]);
  });

  test("anchor_near degrades when scene pool is exhausted even if EngineState.scene is unset", async () => {
    const { k, setState } = tieredKernel({
      router: {
        budget: { ...testRouterBudget, s2Ratio: 1, sceneS2Pool: 1, s2ReservedForAnchors: 0 },
        degrade: ["s2_tier_down"],
        triggers: { anchor_near: { enabled: true, n: 1 } },
      },
      ...chatEvents,
    });
    await k.timeline.append([escalatedRoute()] as never);
    setState({ ...k.timeline.state(), scene: null });
    const { decision } = createRouter(k).decide(routeInput({ anchorNear: true, mode: LLM_MODE }));
    expect(decision.render).toMatchObject({ backend: "llm", tier: "standard" });
    expect(decision.escalated).toBe(false);
    expect(decision.degraded).toContain("s2_tier_down");
  });

  test("allow: reflection and side jobs are free under the rule backend", () => {
    const { k } = tieredKernel({ ...chatEvents });
    k.runtime = {
      mode: () => RULE_MODE,
      pending: () => null,
      switchAt: "turn_boundary",
      setMode: async () => {
        throw new Error("unused");
      },
      models: () => ({ s1: "rule", s2: "rule", s1Llm: false, s2Tiers: [] }),
      beginTurn: async () => RULE_MODE,
      endTurn: async () => {},
      fallbackEnabled: () => false,
    };
    const router = createRouter(k);
    expect(router.allow("reflection")).toEqual({ ok: true, events: [] });
    expect(router.allow("offscreen_narrate")).toEqual({ ok: true, events: [] });
    expect(router.allow("autonomous").ok).toBe(false);
  });
});
