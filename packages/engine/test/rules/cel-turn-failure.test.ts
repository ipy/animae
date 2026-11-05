import { expect, test } from "bun:test";
import { HookRegistry } from "../../src/pipeline/hooks.ts";
import { runTurn } from "../../src/pipeline/run-turn.ts";
import { createMemoryService } from "../../src/memory/service.ts";
import { AnimaeError } from "../../src/types.ts";
import { charDef, createPipelineKernel } from "../pipeline/test-kernel.ts";

test("runtime CEL error fails turn with CEL_EVAL and turn.ended error", async () => {
  const { k, setState } = createPipelineKernel({
    policy: {
      checks: [{ id: "bad", when: "world.vars['missing'] == true", expr: "1d20", dc: 10 }],
      events: { types: { chat: { positive: false } } },
    },
    s1Handler: () => ({
      type: "chat",
      intensity: 0.5,
      sincerity: 1,
      claims: [],
      search_terms: [],
      tags: [],
      input_class: "normal",
    }),
    s2Handler: async function* () {
      yield { text: "nope", intent_realized: "respond" };
    },
  });
  k.m.memory = createMemoryService(k);
  setState({
    ...k.timeline.state(),
    scene: {
      id: "scn_0001",
      location: "loc",
      participants: ["player", "npc1"],
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
  const hooks = new HookRegistry();
  let err: unknown;
  try {
    const gen = runTurn(k, hooks, {
      turnId: "turn_cel_fail",
      sceneId: "scn_0001",
      actor: "player",
      addressee: "npc1",
      speaker: "npc1",
      text: "hi",
    });
    while (!(await gen.next()).done) {
      /* drain */
    }
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(AnimaeError);
  expect((err as AnimaeError).code).toBe("CEL_EVAL");
  const ended = k.timeline.events().find((e) => e.kind === "turn.ended" && e.turn === "turn_cel_fail") as {
    error?: string;
  };
  expect(ended?.error).toBeDefined();
  expect(k.timeline.events().some((e) => e.kind === "utterance" && e.turn === "turn_cel_fail")).toBe(false);
});
