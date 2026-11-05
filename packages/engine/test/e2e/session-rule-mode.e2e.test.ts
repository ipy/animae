import { describe, expect, test } from "bun:test";
import { AnimaeError } from "../../src/types.ts";
import { scriptedLlm } from "../helpers/llm-scripts.ts";
import { eventsOf, narrationsOf, npcLine, playTurn as rulePlayTurn, startScene } from "../helpers/rule-fixture.ts";
import {
  collectTurn,
  forbiddenModels,
  openSessionRuleEngine,
  rulePreset,
} from "./session-fixture.ts";

describe("session rule mode", () => {
  test("no model calls; route.decided shows rule backends", async () => {
    const { calls, models } = forbiddenModels();
    const h = await openSessionRuleEngine({ models, mode: "rule", preset: rulePreset() });
    try {
      const sceneId = await startScene(h.engine);
      await rulePlayTurn(h.engine, sceneId, "hello there");
      await rulePlayTurn(h.engine, sceneId, "thank you very much");
      expect(calls).toEqual([]);
      const routes = await eventsOf(h.engine, "route.decided");
      expect(routes).toHaveLength(2);
      for (const r of routes) {
        expect(r).toMatchObject({ appraise: { backend: "rule" }, render: { backend: "rule" } });
      }
      await h.audit({ snapshots: false });
    } finally {
      await h.dispose();
    }
  });

  test("patterns, commands, choices, narration layers", async () => {
    const h = await openSessionRuleEngine({ mode: "rule" });
    try {
      const sceneId = await startScene(h.engine);
      await rulePlayTurn(h.engine, sceneId, "/care 0.9");
      const withChoices = await rulePlayTurn(h.engine, sceneId, "plain chat");
      expect(withChoices.some((c) => c.type === "choices")).toBe(true);
      const offered = withChoices.find((c) => c.type === "choices");
      expect(offered?.type).toBe("choices");
      const thankId = offered!.choices.find((c) => c.text === "Thank her.")!.id;
      // What the player is offered is logged once, with the same ids and the speaker who offered it.
      const offeredLog = await eventsOf(h.engine, "choice.offered");
      expect(offeredLog.at(-1)).toMatchObject({ speaker: "npc1", choices: offered!.choices.map((c) => expect.objectContaining({ id: c.id, text: c.text })) });
      expect(await eventsOf(h.engine, "choice.taken")).toEqual([]);
      const choiceTurn = await rulePlayTurn(h.engine, sceneId, "", { choiceId: thankId });
      expect(choiceTurn.some((c) => c.type === "text" && c.speaker === "player" && c.text === "Thank her.")).toBe(true);
      const taken = await eventsOf(h.engine, "choice.taken");
      expect(taken).toHaveLength(1);
      expect(taken[0]).toMatchObject({ actor: "player", choiceId: thankId, source: "pipeline:input" });
      const later = await rulePlayTurn(h.engine, sceneId, "see you later");
      expect(narrationsOf(later).some(([, t]) => t.includes("Three hours"))).toBe(true);
      await h.audit({ snapshots: false });
    } finally {
      await h.dispose();
    }
  });

  test("mode switch at turn boundary and fallback reset chunk", async () => {
    const llm = scriptedLlm({
      s2: (req) => {
        if (req.label !== "render") return undefined;
        async function* gen() {
          yield { text: "Hel", cues: [], intent_realized: "talk" };
          throw new AnimaeError("MODEL_TIMEOUT", "stream stalled");
        }
        return gen();
      },
    });
    const h = await openSessionRuleEngine({
      models: { s1: llm.s1, s2: llm.s2 },
      mode: "full",
      yaml: "runtime:\n  fallbackOnError:\n    render: true",
    });
    try {
      const { engine } = h;
      const sceneId = await startScene(engine);
      const turnIter = engine.scene.turn({ sceneId, actor: "player", text: "hello", addressee: "npc1" });
      const chunks: Awaited<ReturnType<typeof rulePlayTurn>> = [];
      let modeChange: Awaited<ReturnType<typeof engine.runtime.setMode>> | undefined;
      for await (const c of turnIter) {
        if (chunks.length === 1 && modeChange === undefined) {
          modeChange = await engine.runtime.setMode("rule");
        }
        chunks.push(c);
      }
      expect(chunks.some((c) => c.type === "reset" && c.reason === "fallback")).toBe(true);
      expect(npcLine(chunks)).toContain("Aria nods");
      expect(modeChange?.pending).toBe(true);

      await rulePlayTurn(engine, sceneId, "after switch");
      expect(engine.runtime.mode()).toEqual({ appraise: "rule", render: "rule" });
      const modes = await eventsOf(engine, "runtime.mode_changed");
      expect(modes.length).toBeGreaterThanOrEqual(2);

      await h.audit({ snapshots: false });
    } finally {
      await h.dispose();
    }
  });

  test("judge-only and narrate-only presets", async () => {
    const judgeLlm = scriptedLlm();
    const h = await openSessionRuleEngine({ models: { s1: judgeLlm.s1, s2: judgeLlm.s2 }, mode: "judge-only" });
    try {
      const sceneId = await startScene(h.engine);
      const chunks = await rulePlayTurn(h.engine, sceneId, "line one");
      expect(npcLine(chunks)).not.toContain("Hello from the model");
      expect(judgeLlm.calls.s2).toEqual([]);
      await h.engine.close();

      const narrateLlm = scriptedLlm();
      const h2 = await openSessionRuleEngine({ models: { s1: narrateLlm.s1, s2: narrateLlm.s2 }, mode: "narrate-only" });
      try {
        const s2 = await startScene(h2.engine);
        const c2 = await rulePlayTurn(h2.engine, s2, "line two");
        expect(npcLine(c2)).toContain("Hello from the model");
        expect(narrateLlm.calls.s1).toEqual([]);
        await h2.audit({ snapshots: false });
      } finally {
        await h2.dispose();
      }
    } finally {
      await h.dispose();
    }
  });

  test("offscreen rule path after world advance (zero model)", async () => {
    const { calls, models } = forbiddenModels();
    const h = await openSessionRuleEngine({ models, mode: "rule" });
    try {
      const sceneId = await startScene(h.engine);
      await rulePlayTurn(h.engine, sceneId, "hello");
      await h.engine.scene.end(sceneId);
      await h.engine.world.advance("1d");
      expect(calls).toEqual([]);
      await h.audit({ snapshots: false });
    } finally {
      await h.dispose();
    }
  });
});
