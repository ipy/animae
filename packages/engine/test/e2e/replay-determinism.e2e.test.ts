import { describe, expect, test } from "bun:test";
import { AnimaeError } from "../../src/types.ts";
import { stableStringify } from "../../src/store/util.ts";
import type { TurnChunk } from "../../src/types.ts";
import type { RuntimeMode } from "../../src/runtime/types.ts";
import { scriptedLlm } from "../helpers/llm-scripts.ts";
import { eventsOf, openRuleEngine, playTurn as rulePlayTurn, startScene } from "../helpers/rule-fixture.ts";
import {
  budgetPreset,
  collectTurn,
  forbiddenModels,
  lifecyclePreset,
  openSessionEngine,
  playTurn,
  streamingLifecycleLlm,
} from "./session-fixture.ts";
import {
  DETERMINISM_EXEMPT_EVENT_KEYS,
  stableEventLogForCompare,
} from "./session-invariants.ts";
import { openReplayRichEngine, replayRichPreset, runRichReplaySession } from "./replay-fixture.ts";

async function replayAll(engine: { timeline: { replay: (b: { name: string }) => AsyncIterable<TurnChunk>; current: () => { name: string } } }): Promise<TurnChunk[]> {
  const out: TurnChunk[] = [];
  for await (const c of engine.timeline.replay(engine.timeline.current())) out.push(c);
  return out;
}

describe("replay determinism I6", () => {
  test("same seed and inputs: event logs match except session id (sid)", async () => {
    const preset = lifecyclePreset();
    const run = async (sessionId: string) => {
      const llm = streamingLifecycleLlm();
      const h = await openSessionEngine({
        preset,
        models: { s1: llm.s1, s2: llm.s2 },
        mode: "full",
        modelMode: "record",
        sessionId,
      });
      try {
        const sceneId = await h.engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
        await collectTurn(h.engine.scene.turn({ sceneId, actor: "player", text: "line a", addressee: "npc1" }));
        await playTurn(h.engine, sceneId, "line b");
        await h.engine.scene.end(sceneId);
        return await h.engine.timeline.events();
      } finally {
        await h.dispose();
      }
    };
    const a = await run("det_sess_a");
    const b = await run("det_sess_b");
    expect(stableEventLogForCompare(a)).toBe(stableEventLogForCompare(b));
    expect(a.some((e, i) => e.sid !== b[i]?.sid)).toBe(true);
    expect(DETERMINISM_EXEMPT_EVENT_KEYS).toEqual(["sid"]);
  });

  test("record then replay: stable chunks in full mode including streaming turn", async () => {
    const llm = streamingLifecycleLlm();
    const h = await openSessionEngine({
      preset: lifecyclePreset(),
      models: { s1: llm.s1, s2: llm.s2 },
      modelMode: "record",
      sessionId: "det_full",
    });
    try {
      const sceneId = await h.engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      await collectTurn(h.engine.scene.turn({ sceneId, actor: "player", text: "stream", addressee: "npc1" }));
      await h.engine.scene.end(sceneId);
      const log = stableStringify(await h.engine.timeline.events());
      const liveReplay = await replayAll(h.engine);
      await h.engine.close();
      const again = await h.reopen({ modelMode: "replay" });
      expect(stableStringify(await again.timeline.events())).toBe(log);
      expect(stableStringify(await replayAll(again))).toBe(stableStringify(liveReplay));
      await again.close();
    } finally {
      await h.dispose();
    }
  });

  const runtimeModes: RuntimeMode[] = [
    { appraise: "rule", render: "rule" },
    { appraise: "llm", render: "rule" },
    { appraise: "rule", render: "llm" },
    { appraise: "llm", render: "llm" },
  ];

  for (const mode of runtimeModes) {
    const label = `${mode.appraise}-${mode.render}`;
    test(`rule/LLM mix (${label}): replay chunks stable twice`, async () => {
      const llm = scriptedLlm();
      const h = await openRuleEngine({
        models: { s1: llm.s1, s2: llm.s2 },
        mode,
        modelMode: "record",
      });
      try {
        const sceneId = await startScene(h.engine);
        await rulePlayTurn(h.engine, sceneId, "determinism probe");
        await h.engine.scene.end(sceneId);
        const once = stableStringify(await replayAll(h.engine));
        const twice = stableStringify(await replayAll(h.engine));
        expect(twice).toBe(once);
        await h.engine.close();
        const reopened = await h.reopen({ modelMode: "replay", mode });
        expect(stableStringify(await replayAll(reopened))).toBe(once);
        await reopened.close();
      } finally {
        await h.dispose();
      }
    });
  }

  test("aborted render with fallback replays committed rule output", async () => {
    const llm = scriptedLlm({
      s2: (req) => {
        if (req.label === "render") throw new AnimaeError("MODEL_TIMEOUT", "fail");
        return undefined;
      },
    });
    const h = await openRuleEngine({
      models: { s1: llm.s1, s2: llm.s2 },
      mode: "full",
      modelMode: "record",
      yaml: "runtime:\n  fallbackOnError:\n    render: true",
    });
    try {
      const sceneId = await startScene(h.engine);
      await rulePlayTurn(h.engine, sceneId, "hello");
      const live = await replayAll(h.engine);
      await h.engine.close();
      const again = await h.reopen({ modelMode: "replay" });
      expect(stableStringify(await replayAll(again))).toBe(stableStringify(live));
      expect(live.some((c) => c.type === "reset")).toBe(false);
      await again.close();
    } finally {
      await h.dispose();
    }
  });

  test("rich replay session: reopen replay mode matches live log", async () => {
    const h = await openReplayRichEngine();
    try {
      await runRichReplaySession(h);
      const log = stableStringify(await h.engine.timeline.events());
      const chunks = await replayAll(h.engine);
      await h.engine.close();
      const replay = await h.reopen({ modelMode: "replay" });
      expect(stableStringify(await replay.timeline.events())).toBe(log);
      expect(stableStringify(await replayAll(replay))).toBe(stableStringify(chunks));
      await replay.close();
    } finally {
      await h.dispose();
    }
  });

  test("budget session record/replay with forbidden models on reopen", async () => {
    const llm = streamingLifecycleLlm();
    const preset = budgetPreset();
    const h = await openSessionEngine({
      preset,
      models: { s1: llm.s1, s2: llm.s2 },
      modelMode: "record",
    });
    try {
      const sceneId = await h.engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      await playTurn(h.engine, sceneId, "mention heirloom secret");
      await h.engine.scene.end(sceneId);
      const plan = await eventsOf(h.engine);
      expect(plan.length).toBeGreaterThan(0);
      await h.engine.close();
      const { calls, models } = forbiddenModels();
      const replay = await h.reopen({ models, modelMode: "replay" });
      expect(calls).toEqual([]);
      await replayAll(replay);
      await replay.close();
    } finally {
      await h.dispose();
    }
  });
});
