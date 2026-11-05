import { describe, expect, test } from "bun:test";
import { AnimaeError, type TurnChunk } from "../../src/types.ts";
import { scriptedLlm } from "../helpers/llm-scripts.ts";
import { eventsOf, narrationsOf, npcLine, openRuleEngine, playTurn, startScene } from "../helpers/rule-fixture.ts";

const FALLBACK_ALL = "runtime:\n  fallbackOnError:\n    appraise: true\n    render: true";

type Route = { appraise: { backend: string }; render: { backend: string } };

/** A render answer that streams one partial and then fails, as a dropped connection would. */
function brokenStream(err: Error) {
  async function* gen() {
    yield { text: "Hel", cues: [], intent_realized: "talk" };
    throw err;
  }
  return gen();
}

describe("S1 failure", () => {
  test("a timed-out appraise is served by the rule backend, the fallback is written, the turn commits", async () => {
    const llm = scriptedLlm({
      s1: (req) => {
        if (req.label === "appraise") throw new AnimaeError("MODEL_TIMEOUT", "S1 call timed out after 30000ms");
        return undefined;
      },
    });
    const h = await openRuleEngine({ models: { s1: llm.s1, s2: llm.s2 }, mode: "full", yaml: FALLBACK_ALL });
    try {
      const { engine } = h;
      const sceneId = await startScene(engine);
      const chunks = await playTurn(engine, sceneId, "hello there");

      expect(chunks.at(-1)?.type).toBe("done");
      // the render still ran on the model: only the S1 call failed
      expect(npcLine(chunks)).toContain("Hello from the model");

      const fallbacks = await eventsOf(engine, "runtime.fallback_used");
      expect(fallbacks).toHaveLength(1);
      expect(fallbacks[0]).toMatchObject({
        phase: "appraise",
        from: "llm",
        to: "rule",
        error: { code: "MODEL_TIMEOUT" },
      });

      // the appraisal is the rule backend's: the policy fallback event, not the model's 0.55
      const appraisal = (await eventsOf(engine, "appraisal"))[0] as unknown as { appraisal: { intensity: number; type: string } };
      expect(appraisal.appraisal).toMatchObject({ type: "chat", intensity: 0.4 });

      // `route.decided` states who actually served each role
      const route = (await eventsOf(engine, "route.decided"))[0] as unknown as Route;
      expect(route.appraise).toEqual({ backend: "rule" });
      expect(route.render).toMatchObject({ backend: "llm" });
    } finally {
      await h.dispose();
    }
  });

  test("a fallback is not a mode change: the engine stays in the mode it was asked for and tries the model again", async () => {
    let failing = true;
    const llm = scriptedLlm({
      s1: (req) => {
        if (req.label === "appraise" && failing) throw new AnimaeError("MODEL_UNREACHABLE", "connection refused");
        return undefined;
      },
    });
    const h = await openRuleEngine({ models: { s1: llm.s1, s2: llm.s2 }, mode: "full", yaml: FALLBACK_ALL });
    try {
      const { engine } = h;
      const sceneId = await startScene(engine);
      await playTurn(engine, sceneId, "one");
      expect(engine.runtime.mode()).toEqual({ appraise: "llm", render: "llm" });
      expect(await eventsOf(engine, "runtime.mode_changed")).toHaveLength(1);

      failing = false;
      await playTurn(engine, sceneId, "two");
      const routes = (await eventsOf(engine, "route.decided")) as unknown as Route[];
      expect(routes.map((r) => r.appraise.backend)).toEqual(["rule", "llm"]);
      expect(await eventsOf(engine, "runtime.fallback_used")).toHaveLength(1);
      expect(llm.calls.s1.filter((l) => l === "appraise")).toHaveLength(2);
    } finally {
      await h.dispose();
    }
  });

  test("without the phase enabled the failure is the turn's failure and nothing is faked", async () => {
    const llm = scriptedLlm({
      s1: (req) => {
        if (req.label === "appraise") throw new AnimaeError("MODEL_TIMEOUT", "S1 call timed out");
        return undefined;
      },
    });
    const h = await openRuleEngine({ models: { s1: llm.s1, s2: llm.s2 }, mode: "full" });
    try {
      const { engine } = h;
      const sceneId = await startScene(engine);
      await expect(playTurn(engine, sceneId, "hello")).rejects.toMatchObject({ code: "MODEL_TIMEOUT" });
      expect(await eventsOf(engine, "runtime.fallback_used")).toHaveLength(0);
      expect(await eventsOf(engine, "utterance")).toHaveLength(0);
    } finally {
      await h.dispose();
    }
  });

  test("only the phase that is enabled falls back", async () => {
    const llm = scriptedLlm({
      s1: (req) => {
        if (req.label === "appraise") throw new AnimaeError("MODEL_TIMEOUT", "S1 call timed out");
        return undefined;
      },
    });
    const h = await openRuleEngine({
      models: { s1: llm.s1, s2: llm.s2 },
      mode: "full",
      yaml: "runtime:\n  fallbackOnError:\n    render: true",
    });
    try {
      const { engine } = h;
      const sceneId = await startScene(engine);
      await expect(playTurn(engine, sceneId, "hello")).rejects.toMatchObject({ code: "MODEL_TIMEOUT" });
    } finally {
      await h.dispose();
    }
  });
});

describe("S2 failure mid-stream", () => {
  test("the partial text is voided with `reset`, the rule backend renders, the turn commits", async () => {
    const llm = scriptedLlm({
      s2: (req) => (req.label === "render" ? brokenStream(new AnimaeError("MODEL_TIMEOUT", "stream stalled")) : undefined),
    });
    const h = await openRuleEngine({ models: { s1: llm.s1, s2: llm.s2 }, mode: "full", yaml: FALLBACK_ALL });
    try {
      const { engine } = h;
      const sceneId = await startScene(engine);
      const chunks = await playTurn(engine, sceneId, "hello there");

      const at = chunks.findIndex((c) => c.type === "reset");
      expect(at).toBeGreaterThan(0);
      expect(chunks[at]).toEqual({ type: "reset", reason: "fallback" });
      // what streamed before the reset belongs to the render that failed
      const before = chunks.slice(0, at);
      expect(before[0]).toMatchObject({ type: "text", speaker: "player", text: "hello there" });
      expect(before.some((c) => c.type === "text" && c.speaker === "npc1" && c.text.startsWith("Hel"))).toBe(true);
      // after it comes the rule render, then the turn's normal ending
      const after = chunks.slice(at + 1);
      expect(npcLine(after)).toBe("Aria nods: hello there");
      expect(narrationsOf(after).length).toBeGreaterThan(0);
      expect(after.at(-1)?.type).toBe("done");
      expect(chunks.filter((c) => c.type === "reset")).toHaveLength(1);

      // the timeline only knows the rule render
      const utterances = (await eventsOf(engine, "utterance")) as unknown as Array<{ text: string; recording?: string }>;
      expect(utterances).toHaveLength(1);
      expect(utterances[0]!.text).toBe("Aria nods: hello there");
      expect(utterances[0]!.recording).toBeUndefined();

      const fallbacks = await eventsOf(engine, "runtime.fallback_used");
      expect(fallbacks).toHaveLength(1);
      expect(fallbacks[0]).toMatchObject({ phase: "render", from: "llm", to: "rule", error: { code: "MODEL_TIMEOUT" } });
      // `route.decided` is the decision taken before the call; `runtime.fallback_used` records that it did not hold
      const route = (await eventsOf(engine, "route.decided"))[0] as unknown as Route;
      expect(route.render).toMatchObject({ backend: "llm", slot: "s2" });
      // the player's own line was kept: the echo is not part of the voided output
      expect(await eventsOf(engine, "input.received")).toHaveLength(1);
    } finally {
      await h.dispose();
    }
  });

  test("replay of a turn that fell back shows the committed render, never the voided one", async () => {
    const llm = scriptedLlm({
      s2: (req) => (req.label === "render" ? brokenStream(new Error("socket hang up")) : undefined),
    });
    const h = await openRuleEngine({ models: { s1: llm.s1, s2: llm.s2 }, mode: "full", yaml: FALLBACK_ALL });
    try {
      const { engine } = h;
      const sceneId = await startScene(engine);
      await playTurn(engine, sceneId, "hello there");
      const replayed: TurnChunk[] = [];
      for await (const c of engine.timeline.replay(engine.timeline.current())) replayed.push(c);
      expect(replayed.some((c) => c.type === "reset")).toBe(false);
      expect(npcLine(replayed)).toBe("Aria nods: hello there");
      expect(replayed.filter((c) => c.type === "text").some((c) => (c as { text: string }).text.startsWith("Hel"))).toBe(false);
    } finally {
      await h.dispose();
    }
  });

  test("a failure before anything streamed falls back without a reset", async () => {
    const llm = scriptedLlm({
      s2: (req) => {
        if (req.label === "render") throw new AnimaeError("MODEL_UNREACHABLE", "connection refused");
        return undefined;
      },
    });
    const h = await openRuleEngine({ models: { s1: llm.s1, s2: llm.s2 }, mode: "full", yaml: FALLBACK_ALL });
    try {
      const { engine } = h;
      const sceneId = await startScene(engine);
      const chunks = await playTurn(engine, sceneId, "hello there");
      expect(chunks.some((c) => c.type === "reset")).toBe(false);
      expect(npcLine(chunks)).toBe("Aria nods: hello there");
      expect(await eventsOf(engine, "runtime.fallback_used")).toHaveLength(1);
    } finally {
      await h.dispose();
    }
  });

  test("without the phase enabled the stream failure ends the turn with the model's error", async () => {
    const llm = scriptedLlm({
      s2: (req) => (req.label === "render" ? brokenStream(new AnimaeError("MODEL_TIMEOUT", "stream stalled")) : undefined),
    });
    const h = await openRuleEngine({ models: { s1: llm.s1, s2: llm.s2 }, mode: "full" });
    try {
      const { engine } = h;
      const sceneId = await startScene(engine);
      const seen: TurnChunk[] = [];
      let failure: unknown;
      try {
        for await (const c of engine.scene.turn({ sceneId, actor: "player", text: "hello", addressee: "npc1" })) seen.push(c);
      } catch (err) {
        failure = err;
      }
      expect(failure).toMatchObject({ code: "MODEL_TIMEOUT" });
      expect(seen.some((c) => c.type === "reset")).toBe(false);
      expect(await eventsOf(engine, "runtime.fallback_used")).toHaveLength(0);
      expect(await eventsOf(engine, "utterance")).toHaveLength(0);
    } finally {
      await h.dispose();
    }
  });

  test("both roles failing in one turn: two fallbacks, one coherent rule turn", async () => {
    const llm = scriptedLlm({
      s1: (req) => {
        if (req.label === "appraise") throw new AnimaeError("MODEL_UNREACHABLE", "connection refused");
        return undefined;
      },
      s2: (req) => (req.label === "render" ? brokenStream(new AnimaeError("MODEL_TIMEOUT", "stream stalled")) : undefined),
    });
    const h = await openRuleEngine({ models: { s1: llm.s1, s2: llm.s2 }, mode: "full", yaml: FALLBACK_ALL });
    try {
      const { engine } = h;
      const sceneId = await startScene(engine);
      const chunks = await playTurn(engine, sceneId, "hello there");
      expect(chunks.at(-1)?.type).toBe("done");
      const phases = ((await eventsOf(engine, "runtime.fallback_used")) as unknown as Array<{ phase: string }>).map((e) => e.phase);
      expect(phases).toEqual(["appraise", "render"]);
      // S1 ran before the route was decided, so the route already names the rule backend for it; the render was decided
      // as an LLM call and only then failed (`runtime.fallback_used` says so)
      const route = (await eventsOf(engine, "route.decided"))[0] as unknown as Route;
      expect(route.appraise).toEqual({ backend: "rule" });
      expect(route.render).toMatchObject({ backend: "llm" });
      // and the next turn goes back to the model
      const llm2 = await playTurn(engine, sceneId, "again");
      expect(llm2.at(-1)?.type).toBe("done");
    } finally {
      await h.dispose();
    }
  });
});

describe("budget exhaustion is not a fallback", () => {
  test("running out of S2 budget degrades with `budget.degraded` and writes no fallback or mode change", async () => {
    const llm = scriptedLlm();
    const h = await openRuleEngine({
      models: { s1: llm.s1, s2: llm.s2 },
      mode: "full",
      // no S2 call is allowed per turn, and the first degrade step hands the render to the rule backend
      preset: (await import("../helpers/rule-fixture.ts")).rulePreset({
        router: { budget: { s2PerTurn: 0 }, degrade: ["s2_to_rule"] },
      }),
    });
    try {
      const { engine } = h;
      const sceneId = await startScene(engine);
      const chunks = await playTurn(engine, sceneId, "hello there");
      expect(npcLine(chunks)).toBe("Aria nods: hello there");
      expect(llm.calls.s2).toEqual([]);

      const degraded = (await eventsOf(engine, "budget.degraded")) as unknown as Array<{ from?: string; to?: string; reason?: string }>;
      expect(degraded.length).toBeGreaterThan(0);
      // `from` names what served the role before (the tier id), `to` what serves it now, `reason` the limit that forced it
      expect(degraded[0]).toMatchObject({ from: "only", to: "rule", reason: "s2PerTurn", action: "s2_to_rule" });
      expect(await eventsOf(engine, "runtime.fallback_used")).toHaveLength(0);
      // the engine's mode is untouched by a per-turn budget decision
      expect(engine.runtime.mode()).toEqual({ appraise: "llm", render: "llm" });
      expect(await eventsOf(engine, "runtime.mode_changed")).toHaveLength(1);
    } finally {
      await h.dispose();
    }
  });
});
