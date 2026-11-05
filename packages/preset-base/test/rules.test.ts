import { test, expect, describe } from "bun:test";
import { createMemoryService } from "../../engine/src/memory/service.ts";
import { HookRegistry } from "../../engine/src/pipeline/hooks.ts";
import { runTurn } from "../../engine/src/pipeline/run-turn.ts";
import { buildCelContext } from "../../engine/src/rules/cel-context.ts";
import { createCelEngine } from "../../engine/src/rules/cel.ts";
import { createRuleEngine } from "../../engine/src/rules/rule-engine.ts";
import { adjudicate } from "../../engine/src/rules/adjudicate.ts";
import { decideIntent } from "../../engine/src/rules/decide.ts";
import { marginal, tierFor, decayStep } from "../../engine/src/rules/primitives.ts";
import { createRng } from "../../engine/src/timeline/rng.ts";
import { createPipelineKernel } from "../../engine/test/pipeline/test-kernel.ts";
import { charDef } from "../../engine/test/pipeline/test-kernel.ts";
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

function wirePipelineTurn(k: ReturnType<typeof createPipelineKernel>["k"], setState: ReturnType<typeof createPipelineKernel>["setState"]) {
  k.m.memory = createMemoryService(k);
  k.m.entities = { checkPromotions: async () => undefined } as never;
  setState({
    ...k.timeline.state(),
    characters: {
      ...k.timeline.state().characters,
      npc: {
        ...k.timeline.state().characters.npc!,
        tracks: { self: { mood: 0 }, toward: { player: { affinity: 50, trust: 50 } } },
      },
    },
    scene: {
      id: "scn_0001",
      location: "loc",
      participants: ["player", "npc"],
      turn: 1,
      startedAt: { day: 1, minute: 0 },
      fields: [],
    },
  });
  k.runtime = {
    mode: () => ({ appraise: "llm", render: "llm" }),
    pending: () => null,
    switchAt: "turn_boundary",
    setMode: async () => {
      throw new Error("unused");
    },
    models: () => ({ s1: "llm", s2: "llm", s1Llm: true, s2Tiers: [] }),
    beginTurn: async () => ({ appraise: "llm", render: "llm" }),
    endTurn: async () => {},
    fallbackEnabled: () => false,
  };
}

async function runInputClassTurn(inputClass: "injection_suspect" | "meta_probe", turnId: string) {
  const policy = await loadBasePolicy();
  const { k, setState } = createPipelineKernel({
    chars: [npcDef(), charDef("player", "supporting")],
    s1Handler: () => ({
      type: "other",
      intensity: 1,
      sincerity: 1,
      claims: [],
      search_terms: [],
      tags: [],
      input_class: inputClass,
    }),
    s2Handler: async function* () {
      yield { text: "ok", intent_realized: "deflect" };
    },
  });
  k.policy = policy;
  wirePipelineTurn(k, setState);
  const hooks = new HookRegistry();
  const gen = runTurn(k, hooks, {
    turnId,
    sceneId: "scn_0001",
    actor: "player",
    addressee: "npc",
    speaker: "npc",
    text: "probe",
  });
  while (!(await gen.next()).done) {
    /* drain */
  }
  return k.timeline.eventsByTurn(turnId);
}

describe("preset-base adjudicate deltas", () => {
  for (const [type, expected] of Object.entries(EVENT_DELTAS)) {
    test(`delta_table ${type}`, async () => {
      const policy = await loadBasePolicy();
      const cel = createCelEngine();
      const rules = createRuleEngine(cel);
      const st = baseState();
      const deps = {
        state: st,
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
        turnId: "turn_0001",
        rng: createRng(1, "main", "adj"),
      });
      for (const [track, delta] of Object.entries(expected)) {
        const td = drafts.find((d) => d.kind === "track.delta" && (d as unknown as { track: string }).track === track) as
          | { delta: number }
          | undefined;
        if (delta === 0) expect(td).toBeUndefined();
        else expect(td?.delta).toBe(delta);
      }
    });
  }
});

describe("intent rules", () => {
  test("decideIntent tie breaks by declaration order", async () => {
    const policy = await loadBasePolicy();
    const cel = createCelEngine();
    const rules = createRuleEngine(cel);
    const st = baseState();
    st.characters.npc!.tracks.toward.player!.trust = 30;
    const deps = {
      state: st,
      authored: authoredStub,
      policy,
      cel,
      rules,
      catalog: catalog(),
      celContext: buildCelContext(
        { state: st, authored: authoredStub, policy, catalog: catalog() },
        { self: "npc", other: "player", actor: "player" },
      ),
    };
    const r = decideIntent(deps, {
      owner: "npc",
      actor: "player",
      appraisal: { type: "request", intensity: 1, sincerity: 1, claims: [], search_terms: [], tags: [], input_class: "normal" },
    });
    expect(r.intent).toBe("negotiate");
  });

  test("input.response mapping", async () => {
    const injEvents = await runInputClassTurn("injection_suspect", "turn_inj");
    const injIntent = injEvents.find((e) => e.kind === "intent.decided") as { intent?: string; forced?: boolean };
    expect(injIntent?.intent).toBe("deflect");
    expect(injIntent?.forced).toBe(true);
    const injMood = injEvents.find((e) => e.kind === "track.delta" && (e as { track?: string }).track === "mood") as
      | { delta?: number; eventType?: string }
      | undefined;
    expect(injMood?.delta).toBe(-5);
    expect(injMood?.eventType).toBe("insincere_speech");

    const metaEvents = await runInputClassTurn("meta_probe", "turn_meta");
    const metaIntent = metaEvents.find((e) => e.kind === "intent.decided") as { intent?: string; forced?: boolean };
    expect(metaIntent?.intent).toBe("deflect");
    expect(metaIntent?.forced).toBe(true);
    const metaTrust = metaEvents.find((e) => e.kind === "track.delta" && (e as { track?: string }).track === "trust") as
      | { delta?: number; eventType?: string }
      | undefined;
    expect(metaTrust?.delta).toBe(-1);
    expect(metaTrust?.eventType).toBe("meta_probe");
  });
});

describe("primitives", () => {
  test("marginal and tierFor", () => {
    expect(marginal(0, 0.5)).toBeCloseTo(1);
    expect(marginal(2, 0.5)).toBeCloseTo(0.5);
    const tiers = [
      { name: "a", from: 0 },
      { name: "b", from: 50 },
    ];
    expect(tierFor(60, tiers, null, 0).tier).toBe("b");
  });

  test("decayStep", () => {
    expect(decayStep(10, { toward: 0, ratePerHour: 0.1 }, 1)).toBeLessThan(10);
  });
});
