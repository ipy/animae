import { describe, expect, test } from "bun:test";
import { createScriptedModel } from "../../src/model/scripted.ts";
import type { TurnChunk } from "../../src/types.ts";
import { eventsOf, narrationsOf, npcLine, openRuleEngine, playTurn, startScene } from "../helpers/rule-fixture.ts";

/** Scripted models that fail the test when anything calls them. */
function forbiddenModels() {
  const calls: string[] = [];
  const handler = (req: { label?: string }) => {
    calls.push(req.label ?? "?");
    throw new Error(`model called in rule mode: ${req.label}`);
  };
  return { calls, models: { s1: createScriptedModel("forbidden/s1", handler), s2: createScriptedModel("forbidden/s2", handler) } };
}

const LINES = [
  "hello there",
  "thank you, that helps",
  "what is the rain like",
  "/care 0.9",
  "see you later",
  "thanks again",
  "tell me more",
  "who are you",
  "good night",
  "one more thing",
];

async function playAll(engine: Parameters<typeof playTurn>[0], sceneId: Parameters<typeof playTurn>[1]): Promise<TurnChunk[][]> {
  const turns: TurnChunk[][] = [];
  for (const line of LINES) turns.push(await playTurn(engine, sceneId, line));
  return turns;
}

describe("rule mode: the whole game at zero tokens", () => {
  test("ten turns never call a model, even when models are configured", async () => {
    const { calls, models } = forbiddenModels();
    const h = await openRuleEngine({ models, mode: "rule" });
    try {
      expect(h.engine.runtime.mode()).toEqual({ appraise: "rule", render: "rule" });
      const sceneId = await startScene(h.engine);
      const turns = await playAll(h.engine, sceneId);
      expect(calls).toEqual([]);
      for (const chunks of turns) {
        expect(chunks.at(-1)?.type).toBe("done");
        expect(npcLine(chunks).length).toBeGreaterThan(0);
      }
      await h.engine.scene.end(sceneId);
      // ending the scene (reflection, memory writes) is rule-served too
      expect(calls).toEqual([]);
    } finally {
      await h.dispose();
    }
  });

  test("an engine with no models at all plays the same way", async () => {
    const h = await openRuleEngine();
    try {
      expect(h.engine.info().models).toMatchObject({ s1: "rule", s2: "rule", s1Llm: false, s2Tiers: [] });
      const sceneId = await startScene(h.engine);
      const chunks = await playTurn(h.engine, sceneId, "hello there");
      expect(npcLine(chunks)).toContain("Aria nods: hello there");
    } finally {
      await h.dispose();
    }
  });

  test("every turn records that rules decided it", async () => {
    const h = await openRuleEngine();
    try {
      const sceneId = await startScene(h.engine);
      await playTurn(h.engine, sceneId, "hello there");
      await playTurn(h.engine, sceneId, "thanks");
      const routes = await eventsOf(h.engine, "route.decided");
      expect(routes).toHaveLength(2);
      for (const r of routes) {
        expect(r).toMatchObject({
          appraise: { backend: "rule" },
          render: { backend: "rule" },
          budget: { s1Calls: 0 },
        });
        expect((r as unknown as { budget: { s2CallsByTier: Record<string, number> } }).budget.s2CallsByTier).toEqual({});
      }
      const modes = await eventsOf(h.engine, "runtime.mode_changed");
      expect(modes).toHaveLength(1);
      expect(modes[0]).toMatchObject({ before: null, after: { appraise: "rule", render: "rule" } });
    } finally {
      await h.dispose();
    }
  });

  test("player input is appraised by the rule paths in priority order", async () => {
    const h = await openRuleEngine();
    try {
      const sceneId = await startScene(h.engine);
      // (2) a command beats everything below it
      await playTurn(h.engine, sceneId, "/care 0.9");
      // (3) a pattern
      await playTurn(h.engine, sceneId, "thank you very much");
      // (1) the metadata of the choice that was taken
      const chunks = await playTurn(h.engine, sceneId, "", { choiceId: "c2" });
      // (4) the fallback
      await playTurn(h.engine, sceneId, "plain words with no pattern");
      const appraisals = ((await eventsOf(h.engine, "appraisal")) as unknown as Array<{
        appraisal: { type: string; intensity: number };
      }>).map((e) => e.appraisal);
      expect(appraisals.map((a) => a.type)).toEqual(["care", "care", "chat", "chat"]);
      expect(appraisals[0]!.intensity).toBeCloseTo(0.9);
      expect(appraisals[1]!.intensity).toBeCloseTo(0.7);
      // the chosen option's own line is echoed as the player's utterance
      expect(chunks[0]).toMatchObject({ type: "text", speaker: "player", text: "Ask about the rain." });
      expect(appraisals[3]!.intensity).toBeCloseTo(0.4);
    } finally {
      await h.dispose();
    }
  });
});

describe("rule mode is deterministic", () => {
  test("the same seed and inputs give the same chunks in two fresh engines", async () => {
    const a = await openRuleEngine({ seed: 7 });
    const b = await openRuleEngine({ seed: 7 });
    try {
      const sa = await startScene(a.engine);
      const sb = await startScene(b.engine);
      const ca = await playAll(a.engine, sa);
      const cb = await playAll(b.engine, sb);
      expect(JSON.stringify(ca)).toBe(JSON.stringify(cb));
    } finally {
      await a.dispose();
      await b.dispose();
    }
  });

  test("different seeds are allowed to vary the weighted picks, never the structure", async () => {
    const seen = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const h = await openRuleEngine({ seed });
      try {
        const sceneId = await startScene(h.engine);
        const chunks = await playTurn(h.engine, sceneId, "hello there");
        seen.add(JSON.stringify(narrationsOf(chunks)));
        expect(chunks.map((c) => c.type)).toEqual(["text", "narration", "text", "choices", "done"]);
      } finally {
        await h.dispose();
      }
    }
    // two narration lines in the pool: six seeds reach both
    expect(seen.size).toBeGreaterThan(1);
  });

  test("timeline.replay of a rule-mode branch is byte-identical every time", async () => {
    const h = await openRuleEngine({ seed: 11 });
    try {
      const sceneId = await startScene(h.engine);
      await playAll(h.engine, sceneId);
      await h.engine.scene.end(sceneId);
      const branch = h.engine.timeline.current();
      const replay = async () => {
        const chunks: TurnChunk[] = [];
        for await (const c of h.engine.timeline.replay(branch)) chunks.push(c);
        return JSON.stringify(chunks);
      };
      const first = await replay();
      const second = await replay();
      expect(first.length).toBeGreaterThan(100);
      expect(second).toBe(first);
      // and a fresh process reading the same timeline replays the same bytes
      const again = await h.reopen();
      const chunks: TurnChunk[] = [];
      for await (const c of again.timeline.replay(again.timeline.current())) chunks.push(c);
      expect(JSON.stringify(chunks)).toBe(first);
    } finally {
      await h.dispose();
    }
  });

  test("replay reproduces what the live turn streamed (narration included)", async () => {
    const h = await openRuleEngine({ seed: 5 });
    try {
      const sceneId = await startScene(h.engine);
      const live = await playAll(h.engine, sceneId);
      const liveText = live.flat().filter((c) => c.type === "text" || c.type === "narration");
      const replayed: TurnChunk[] = [];
      for await (const c of h.engine.timeline.replay(h.engine.timeline.current())) replayed.push(c);
      const replayText = replayed.filter((c) => c.type === "text" || c.type === "narration");
      expect(replayText).toEqual(liveText);
    } finally {
      await h.dispose();
    }
  });
});
