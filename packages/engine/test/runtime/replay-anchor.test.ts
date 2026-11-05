import { describe, expect, test } from "bun:test";
import { replayPlan } from "../../src/timeline/replay-plan.ts";
import { recordingsPath } from "../../src/timeline/paths.ts";
import { FsStorage } from "../../src/store/fs.ts";
import type { TurnChunk } from "../../src/types.ts";
import { scriptedLlm } from "../helpers/llm-scripts.ts";
import { eventsOf, openRuleEngine, playTurn, startScene, type RuleEngineHandle } from "../helpers/rule-fixture.ts";

/** Drop the recording lines whose key is in `drop`. */
async function dropRecordings(h: RuleEngineHandle, drop: ReadonlySet<string>): Promise<number> {
  const storage = FsStorage(h.root);
  const path = recordingsPath("main");
  const text = (await storage.readText(path)) ?? "";
  const kept = text
    .split("\n")
    .filter((line) => line.trim() && !drop.has((JSON.parse(line) as { key: string }).key));
  await storage.writeAtomic(path, kept.length ? `${kept.join("\n")}\n` : "");
  return kept.length;
}

/**
 * Record a run whose turns were served by different backends:
 *   turn 1, 2: full (S1 + S2 on models)      turn 3, 4: rule
 *   turn 5:    judge-only (S1 model, S2 rule)
 */
async function recordMixedRun() {
  const llm = scriptedLlm();
  const h = await openRuleEngine({ models: { s1: llm.s1, s2: llm.s2 }, mode: "full", modelMode: "record" });
  const { engine } = h;
  const sceneId = await startScene(engine);
  await playTurn(engine, sceneId, "one");
  await playTurn(engine, sceneId, "two");
  await engine.runtime.setMode("rule");
  await playTurn(engine, sceneId, "three");
  await playTurn(engine, sceneId, "four");
  await engine.runtime.setMode("judge-only");
  await playTurn(engine, sceneId, "five");
  await engine.scene.end(sceneId);
  const plan = replayPlan(await eventsOf(engine));
  await engine.close();
  return { h, llm, plan };
}

async function replayAll(engine: RuleEngineHandle["engine"]): Promise<TurnChunk[]> {
  const out: TurnChunk[] = [];
  for await (const c of engine.timeline.replay(engine.timeline.current())) out.push(c);
  return out;
}

describe("replay follows `route.decided`, not the engine's current mode", () => {
  test("the plan of a recorded run says which backend served each role of each turn", async () => {
    const { h, plan } = await recordMixedRun();
    try {
      expect(plan.turns.map((t) => [t.appraise?.backend, t.render?.backend])).toEqual([
        ["llm", "llm"],
        ["llm", "llm"],
        ["rule", "rule"],
        ["rule", "rule"],
        ["llm", "rule"],
      ]);
      // recordings exist exactly for the calls a model served: appraise + render, none, appraise only
      expect(plan.turns.map((t) => t.recordings.map((r) => r.event))).toEqual([
        ["appraisal", "utterance"],
        ["appraisal", "utterance"],
        [],
        [],
        ["appraisal"],
      ]);
      // the mode in force when each turn began is tracked from `runtime.mode_changed`
      expect(plan.turns.map((t) => `${t.mode?.appraise}/${t.mode?.render}`)).toEqual([
        "llm/llm",
        "llm/llm",
        "rule/rule",
        "rule/rule",
        "llm/rule",
      ]);
      expect(plan.turns.every((t) => t.fallbacks.length === 0)).toBe(true);
    } finally {
      await h.dispose();
    }
  });

  test("an engine that is in rule mode now still replays the LLM turns from their recordings", async () => {
    const { h } = await recordMixedRun();
    try {
      const rule = await h.reopen({ modelMode: "replay", mode: "rule" });
      expect(rule.runtime.mode()).toEqual({ appraise: "rule", render: "rule" });
      const chunks = await replayAll(rule);
      expect(chunks.filter((c) => c.type === "done")).toHaveLength(5);
      // the two LLM turns' lines are the model's, as recorded
      const spoken = chunks.filter((c) => c.type === "text" && (c as { speaker?: string }).speaker === "npc1");
      expect(spoken.slice(0, 2).map((c) => (c as { text: string }).text)).toEqual([
        "Hello from the model 1.",
        "Hello from the model 2.",
      ]);
    } finally {
      await h.dispose();
    }
  });

  test("a missing recording is an error naming exactly the LLM-served calls, whatever the current mode", async () => {
    const { h, plan } = await recordMixedRun();
    try {
      const turn1 = plan.turns[0]!.recordings.map((r) => r.key);
      const turn5 = plan.turns[4]!.recordings.map((r) => r.key);
      await dropRecordings(h, new Set([...turn1, ...turn5]));
      for (const mode of ["rule", "full"] as const) {
        const e = await h.reopen({ modelMode: "replay", mode });
        let failure: unknown;
        try {
          await replayAll(e);
        } catch (err) {
          failure = err;
        }
        expect(failure).toMatchObject({ code: "RECORDING_MISSING" });
        const missing = (failure as { details: { missing: { turn: string; key: string }[] } }).details.missing;
        expect(missing.map((m) => m.key).sort()).toEqual([...turn1, ...turn5].sort());
        // never the rule turns, and never turn 2, whose recordings were kept
        const turns = new Set(missing.map((m) => m.turn));
        expect(turns).toEqual(new Set([plan.turns[0]!.turn, plan.turns[4]!.turn]));
      }
    } finally {
      await h.dispose();
    }
  });

  test("a rule-only run replays with no recordings at all, even in an engine that is in LLM mode now", async () => {
    const h = await openRuleEngine({ modelMode: "record" });
    try {
      const { engine } = h;
      const sceneId = await startScene(engine);
      await playTurn(engine, sceneId, "one");
      await playTurn(engine, sceneId, "two");
      const live = await replayAll(engine);
      await engine.close();
      // nothing was recorded: no model ever ran
      const text = (await FsStorage(h.root).readText(recordingsPath("main"))) ?? "";
      expect(text.trim()).toBe("");

      const llm = scriptedLlm();
      const again = await h.reopen({ modelMode: "replay", models: { s1: llm.s1, s2: llm.s2 }, mode: "full" });
      expect(again.runtime.mode()).toEqual({ appraise: "llm", render: "llm" });
      const replayed = await replayAll(again);
      expect(JSON.stringify(replayed)).toBe(JSON.stringify(live));
      // replaying calls no model
      expect(llm.calls.s1).toEqual([]);
      expect(llm.calls.s2).toEqual([]);
    } finally {
      await h.dispose();
    }
  });

  test("a turn that fell back to rules is replayed from its events and needs no recording for the failed call", async () => {
    const llm = scriptedLlm({
      s2: (req) => {
        if (req.label === "render") throw new Error("connection reset");
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
      await playTurn(engine, sceneId, "hello there");
      const plan = replayPlan(await eventsOf(engine));
      expect(plan.turns[0]!.fallbacks).toEqual([{ phase: "render", code: "RENDER_FAILED" }]);
      // only the S1 call has a recording; the failed S2 call left none and the rule line has none
      expect(plan.turns[0]!.recordings.map((r) => r.event)).toEqual(["appraisal"]);
      await engine.close();
      const again = await h.reopen({ modelMode: "replay" });
      const chunks = await replayAll(again);
      expect(chunks.at(-1)?.type).toBe("done");
    } finally {
      await h.dispose();
    }
  });
});
