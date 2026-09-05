import { test, expect, describe } from "bun:test";
import { createRouter } from "../../src/router/router.ts";
import { detectContradiction } from "../../src/router/contradiction.ts";
import { evaluateTriggers, isAmbiguous } from "../../src/router/triggers.ts";
import { createPipelineKernel, charDef } from "../pipeline/test-kernel.ts";
import { applyPolicyDefaults } from "../../src/policy/defaults.ts";
import type { Appraisal } from "../../src/events.ts";
import type { RouteInput } from "../../src/contracts.ts";
import { testRouterBudget, testBudgetState } from "../helpers/policy-fixtures.ts";

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

describe("router budget", () => {
  test("degrades s2 to s1 when scene pool exhausted", async () => {
    const { k } = createPipelineKernel({
      policy: {
        router: {
          budget: { ...testRouterBudget, s2PerTurn: 1, s2Ratio: 1, sceneS2Pool: 1, s2ReservedForAnchors: 0 },
          degrade: ["s2_to_s1"],
          triggers: { scene_first: { enabled: true } },
        },
        events: { types: { chat: { positive: false } } },
      },
    });
    const router = createRouter(k);
    await k.timeline.append([
      { kind: "route.decided", tier: "s2", reasons: ["x"], scene: "scn_0001", turn: "turn_0000" },
    ] as never);
    const { decision, events } = router.decide(routeInput({ sceneFirstTurn: true }));
    expect(decision.tier).toBe("s1");
    expect(decision.degraded).toContain("s2_to_s1");
    expect(events.some((e) => e.kind === "budget.degraded")).toBe(true);
  });

  test("anchor_near keeps s2 when within reserved pool", async () => {
    const { k } = createPipelineKernel({
      policy: {
        router: {
          budget: { ...testRouterBudget, s2PerTurn: 1, s2Ratio: 1, sceneS2Pool: 2, s2ReservedForAnchors: 0.5 },
          degrade: ["s2_to_s1"],
          triggers: { anchor_near: { enabled: true, n: 1 } },
        },
        events: { types: { chat: { positive: false } } },
      },
    });
    const router = createRouter(k);
    await k.timeline.append([
      { kind: "route.decided", tier: "s2", reasons: ["x"], scene: "scn_0001", turn: "turn_0000" },
    ] as never);
    const { decision } = router.decide(routeInput({ anchorNear: true }));
    expect(decision.tier).toBe("s2");
  });

  test("s2Ratio forces degrade path", () => {
    const { k, setState } = createPipelineKernel({
      policy: {
        router: {
          budget: { ...testRouterBudget, s2PerTurn: 2, s2Ratio: 0.1, sceneS2Pool: 10, s2ReservedForAnchors: 0 },
          degrade: ["s2_to_s1"],
          triggers: { scene_first: { enabled: true } },
        },
        events: { types: { chat: { positive: false } } },
      },
    });
    setState({
      ...k.timeline.state(),
      budget: { ...testBudgetState, turns: 10, s2Turns: 5 },
    });
    const router = createRouter(k);
    const { decision } = router.decide(routeInput({ sceneFirstTurn: true }));
    expect(decision.tier).toBe("s1");
    expect(decision.degraded).toContain("s2_to_s1");
  });

  test("degrade order applies defer_reflection when budget blocks s2", () => {
    const { k } = createPipelineKernel({
      policy: {
        router: {
          budget: { ...testRouterBudget, s2PerTurn: 0, s2Ratio: 1, sceneS2Pool: 10, s2ReservedForAnchors: 0 },
          degrade: ["defer_reflection"],
          triggers: { scene_first: { enabled: true } },
        },
        events: { types: { chat: { positive: false } } },
      },
    });
    const router = createRouter(k);
    router.decide(routeInput({ sceneFirstTurn: true }));
    expect(router.allow("reflection").ok).toBe(false);
    expect(router.allow("reflection").events[0]?.kind).toBe("budget.degraded");
  });

  test("allow denies autonomous when skip flag set via degrade", () => {
    const { k } = createPipelineKernel({
      policy: {
        router: {
          budget: { ...testRouterBudget, s2PerTurn: 0, s2Ratio: 0, sceneS2Pool: 0, s2ReservedForAnchors: 0 },
          degrade: ["s2_to_s1", "skip_autonomous"],
          triggers: { scene_first: { enabled: true } },
        },
        events: { types: { chat: { positive: false } } },
      },
    });
    const router = createRouter(k);
    router.decide(routeInput({ sceneFirstTurn: true }));
    const allow = router.allow("autonomous");
    expect(allow.ok).toBe(false);
  });
});
