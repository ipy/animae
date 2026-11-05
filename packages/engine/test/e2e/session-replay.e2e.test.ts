import { describe, expect, test } from "bun:test";
import { AnimaeError } from "../../src/types.ts";
import { recordingsPath } from "../../src/timeline/paths.ts";
import { replayPlan } from "../../src/timeline/replay-plan.ts";
import { stableStringify } from "../../src/store/util.ts";
import { FsStorage } from "../../src/store/fs.ts";
import type { TurnChunk } from "../../src/types.ts";
import { scriptedLlm } from "../helpers/llm-scripts.ts";
import { eventsOf, openRuleEngine, playTurn as rulePlayTurn, startScene } from "../helpers/rule-fixture.ts";
import type { Engine } from "../../src/api.ts";
import { assertLogInvariants } from "./session-invariants.ts";
import { budgetPreset, collectTurn, lifecyclePreset, openSessionEngine, playTurn, streamingLifecycleLlm } from "./session-fixture.ts";
import { replayChunks } from "../../src/timeline/replay.ts";

async function replayAll(engine: Engine): Promise<TurnChunk[]> {
  const out: TurnChunk[] = [];
  for await (const c of engine.timeline.replay(engine.timeline.current())) out.push(c);
  return out;
}

describe("session replay (I6)", () => {
  test("record then replay: byte-identical event log and chunk stream", async () => {
    const llm = scriptedLlm();
    const h = await openSessionEngine({
      preset: lifecyclePreset(),
      models: { s1: llm.s1, s2: llm.s2 },
      modelMode: "record",
      sessionId: "replay_i6",
    });
    try {
      const { engine } = h;
      const sceneId = await engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      const liveChunks: TurnChunk[] = [];
      for (let i = 0; i < 3; i++) {
        const t = await collectTurn(engine.scene.turn({ sceneId, actor: "player", text: `line ${i}`, addressee: "npc1" }));
        liveChunks.push(...t.chunks);
      }
      await engine.world.advance("1d");
      await engine.scene.end(sceneId);
      const eventLog = stableStringify(await engine.timeline.events());
      assertLogInvariants(await engine.timeline.events());
      await engine.close();

      const replayEngine = await h.reopen({ modelMode: "replay", sessionId: "replay_i6_b" });
      const replayChunks = await replayAll(replayEngine);
      const replayLog = stableStringify(await replayEngine.timeline.events());
      expect(replayLog).toBe(eventLog);
      expect(stableStringify(replayChunks)).toBe(stableStringify(liveChunks));
      await replayEngine.close();
    } finally {
      await h.dispose();
    }
  });

  test("mixed LLM and rule turns replay without recordings for rule turns", async () => {
    const llm = scriptedLlm();
    const h = await openRuleEngine({ models: { s1: llm.s1, s2: llm.s2 }, mode: "full", modelMode: "record" });
    try {
      const { engine } = h;
      const sceneId = await startScene(engine);
      await rulePlayTurn(engine, sceneId, "one");
      await engine.runtime.setMode("rule");
      await rulePlayTurn(engine, sceneId, "two");
      await rulePlayTurn(engine, sceneId, "three");
      await engine.scene.end(sceneId);
      const plan = replayPlan(await eventsOf(engine));
      expect(plan.turns[0]!.recordings.length).toBeGreaterThan(0);
      expect(plan.turns[1]!.recordings).toEqual([]);
      const live = await replayAll(engine);
      await engine.close();

      const again = await h.reopen({ modelMode: "replay", mode: "rule" });
      const replayed = await replayAll(again);
      expect(stableStringify(replayed)).toBe(stableStringify(live));
      expect(llm.calls.s1.length).toBeGreaterThan(0);
      await again.close();
    } finally {
      await h.dispose();
    }
  });

  test("missing recording yields RECORDING_MISSING with details", async () => {
    const llm = scriptedLlm();
    const h = await openRuleEngine({ models: { s1: llm.s1, s2: llm.s2 }, mode: "full", modelMode: "record" });
    try {
      const { engine } = h;
      const sceneId = await startScene(engine);
      await rulePlayTurn(engine, sceneId, "record me");
      await engine.scene.end(sceneId);
      const plan = replayPlan(await eventsOf(engine));
      const key = plan.turns[0]!.recordings[0]!.key;
      const storage = FsStorage(h.root);
      const path = recordingsPath("main");
      const text = (await storage.readText(path)) ?? "";
      const kept = text.split("\n").filter((line) => line.trim() && !line.includes(key));
      await storage.writeAtomic(path, kept.length ? `${kept.join("\n")}\n` : "");
      await engine.close();

      const replay = await h.reopen({ modelMode: "replay" });
      let err: unknown;
      try {
        await replayAll(replay);
      } catch (e) {
        err = e;
      }
      expect(err).toMatchObject({ code: "RECORDING_MISSING" });
      await replay.close();
    } finally {
      await h.dispose();
    }
  });

  test("fallback turn replays committed rule render without failed recording", async () => {
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
      const { engine } = h;
      const sceneId = await startScene(engine);
      await rulePlayTurn(engine, sceneId, "hello");
      const plan = replayPlan(await eventsOf(engine));
      expect(plan.turns[0]!.fallbacks).toEqual([{ phase: "render", code: "MODEL_TIMEOUT" }]);
      await engine.close();
      const again = await h.reopen({ modelMode: "replay" });
      const chunks = await replayAll(again);
      expect(chunks.some((c) => c.type === "reset")).toBe(false);
      await again.close();
    } finally {
      await h.dispose();
    }
  });

  test("streaming live partials vs replay utterance chunks (event-log replay)", async () => {
    const llm = streamingLifecycleLlm();
    const h = await openSessionEngine({
      preset: lifecyclePreset(),
      models: { s1: llm.s1, s2: llm.s2 },
      modelMode: "record",
    });
    try {
      const { engine } = h;
      const sceneId = await engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      const live = await collectTurn(engine.scene.turn({ sceneId, actor: "player", text: "stream", addressee: "npc1" }));
      const log = await engine.timeline.events();
      const fromEvents = replayChunks(log);
      expect(stableStringify(await engine.timeline.events())).toBe(stableStringify(log));
      expect(fromEvents.filter((c) => c.type === "text" && c.speaker === "npc1").map((c) => (c as { text: string }).text).join("")).toBe(
        "PartA-1 PartB PartC.",
      );
      expect(live.chunks.filter((c) => c.type === "text" && c.speaker === "npc1").length).toBeGreaterThan(1);
      await engine.scene.end(sceneId);
      await engine.close();
      const replayEngine = await h.reopen({ modelMode: "replay" });
      expect(stableStringify(await replayAll(replayEngine))).toBe(stableStringify(fromEvents));
      await replayEngine.close();
    } finally {
      await h.dispose();
    }
  });

  test("budget + distortion session stays stable on replay", async () => {
    const llm = streamingLifecycleLlm();
    const h = await openSessionEngine({
      preset: budgetPreset(),
      models: { s1: llm.s1, s2: llm.s2 },
      modelMode: "record",
    });
    try {
      const { engine } = h;
      const sceneId = await engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      await playTurn(engine, sceneId, "mention heirloom secret");
      await engine.scene.end(sceneId);
      const logA = stableStringify(await engine.timeline.events());
      const chunksA = await replayAll(engine);
      await engine.close();
      const replay = await h.reopen({ modelMode: "replay" });
      expect(stableStringify(await replay.timeline.events())).toBe(logA);
      expect(stableStringify(await replayAll(replay))).toBe(stableStringify(chunksA));
      await replay.close();
    } finally {
      await h.dispose();
    }
  });
});
