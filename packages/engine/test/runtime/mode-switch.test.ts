import { describe, expect, test } from "bun:test";
import type { RuntimeMode } from "../../src/runtime/types.ts";
import type { TurnChunk } from "../../src/types.ts";
import { scriptedLlm } from "../helpers/llm-scripts.ts";
import { eventsOf, narrationsOf, npcLine, openRuleEngine, playTurn, startScene } from "../helpers/rule-fixture.ts";

type Route = { appraise: { backend: string; slot?: string }; render: { backend: string; slot?: string; tier?: string } };

async function routes(engine: Parameters<typeof eventsOf>[0]): Promise<Route[]> {
  return (await eventsOf(engine, "route.decided")) as unknown as Route[];
}

/** A turn is valid when it streams the player's echo, an NPC line and ends in `done` with its events. */
function expectValidTurn(chunks: TurnChunk[]): void {
  expect(chunks[0]).toMatchObject({ type: "text", speaker: "player" });
  expect(npcLine(chunks).length).toBeGreaterThan(0);
  const last = chunks.at(-1);
  expect(last?.type).toBe("done");
  expect((last as { events: string[] }).events.length).toBeGreaterThan(0);
}

describe("mode switching between turns", () => {
  test("LLM -> rule -> LLM: ten valid turns, each served by the backend the mode named", async () => {
    const llm = scriptedLlm();
    const h = await openRuleEngine({ models: { s1: llm.s1, s2: llm.s2 }, mode: "full" });
    try {
      const { engine } = h;
      const sceneId = await startScene(engine);
      const plan: Array<"full" | "rule"> = ["full", "full", "full", "rule", "rule", "rule", "full", "full", "full", "full"];
      let mode: "full" | "rule" = "full";
      for (const [i, want] of plan.entries()) {
        if (want !== mode) {
          const change = await engine.runtime.setMode(want, { trigger: "test" });
          expect(change.pending).toBe(false);
          mode = want;
        }
        const chunks = await playTurn(engine, sceneId, `line ${i + 1}`);
        expectValidTurn(chunks);
      }
      const served = (await routes(engine)).map((r) => (r.appraise.backend === "llm" && r.render.backend === "llm" ? "full" : "rule"));
      expect(served).toEqual(plan);
      // the model was asked exactly for the LLM turns: one appraise + one render each
      expect(llm.calls.s1.filter((l) => l === "appraise")).toHaveLength(7);
      expect(llm.calls.s2.filter((l) => l === "render")).toHaveLength(7);
      // every switch is announced once, with who asked
      const changes = (await eventsOf(engine, "runtime.mode_changed")) as unknown as Array<{
        before: RuntimeMode | null;
        after: RuntimeMode;
        reason: string;
        trigger?: string;
      }>;
      expect(changes.map((c) => c.after.render)).toEqual(["llm", "rule", "llm"]);
      expect(changes[1]).toMatchObject({ reason: "api", trigger: "test", before: { appraise: "llm", render: "llm" } });
    } finally {
      await h.dispose();
    }
  });

  test("rule -> LLM -> rule: ten valid turns", async () => {
    const llm = scriptedLlm();
    const h = await openRuleEngine({ models: { s1: llm.s1, s2: llm.s2 }, mode: "rule" });
    try {
      const { engine } = h;
      const sceneId = await startScene(engine);
      const plan: Array<"full" | "rule"> = ["rule", "rule", "rule", "full", "full", "full", "full", "rule", "rule", "rule"];
      let mode: "full" | "rule" = "rule";
      for (const [i, want] of plan.entries()) {
        if (want !== mode) {
          await engine.runtime.setMode(want);
          mode = want;
        }
        expectValidTurn(await playTurn(engine, sceneId, `line ${i + 1}`));
      }
      const served = (await routes(engine)).map((r) => (r.render.backend === "llm" ? "full" : "rule"));
      expect(served).toEqual(plan);
      expect(llm.calls.s2.filter((l) => l === "render")).toHaveLength(4);
    } finally {
      await h.dispose();
    }
  });

  test("LLM appraise + rule render ('judge-only'): the model judges, templates speak", async () => {
    const llm = scriptedLlm();
    const h = await openRuleEngine({ models: { s1: llm.s1, s2: llm.s2 }, mode: "judge-only" });
    try {
      const { engine } = h;
      const sceneId = await startScene(engine);
      for (let i = 0; i < 10; i++) {
        const chunks = await playTurn(engine, sceneId, `line ${i + 1}`);
        expectValidTurn(chunks);
        // spoken by the template pool, not by the model
        expect(npcLine(chunks)).not.toContain("Hello from the model");
        // the narration layers still apply
        expect(narrationsOf(chunks).length).toBeGreaterThan(0);
      }
      expect(llm.calls.s1.filter((l) => l === "appraise")).toHaveLength(10);
      expect(llm.calls.s2).toEqual([]);
      for (const r of await routes(engine)) {
        expect(r.appraise).toMatchObject({ backend: "llm", slot: "s1" });
        expect(r.render).toEqual({ backend: "rule" });
      }
      // appraisals came from the model's schema-valid answer
      const appraisals = (await eventsOf(engine, "appraisal")) as unknown as Array<{ appraisal: { intensity: number } }>;
      for (const a of appraisals) expect(a.appraisal.intensity).toBeCloseTo(0.55);
    } finally {
      await h.dispose();
    }
  });

  test("rule appraise + LLM render ('narrate-only'): rules judge, the model speaks", async () => {
    const llm = scriptedLlm();
    const h = await openRuleEngine({ models: { s1: llm.s1, s2: llm.s2 }, mode: "narrate-only" });
    try {
      const { engine } = h;
      const sceneId = await startScene(engine);
      for (let i = 0; i < 10; i++) {
        const chunks = await playTurn(engine, sceneId, `line ${i + 1}`);
        expectValidTurn(chunks);
        expect(npcLine(chunks)).toContain("Hello from the model");
      }
      expect(llm.calls.s1).toEqual([]);
      expect(llm.calls.s2.filter((l) => l === "render")).toHaveLength(10);
      for (const r of await routes(engine)) {
        expect(r.appraise).toEqual({ backend: "rule" });
        expect(r.render).toMatchObject({ backend: "llm", slot: "s2" });
      }
      // rule appraisal: the policy's fallback event, not the model's
      const appraisals = (await eventsOf(engine, "appraisal")) as unknown as Array<{ appraisal: { intensity: number } }>;
      for (const a of appraisals) expect(a.appraisal.intensity).toBeCloseTo(0.4);
    } finally {
      await h.dispose();
    }
  });

  test("a single role can be switched on its own, leaving the other as it was", async () => {
    const llm = scriptedLlm();
    const h = await openRuleEngine({ models: { s1: llm.s1, s2: llm.s2 }, mode: "full" });
    try {
      const { engine } = h;
      await engine.runtime.setMode({ render: "rule" });
      expect(engine.runtime.mode()).toEqual({ appraise: "llm", render: "rule" });
      await engine.runtime.setMode({ appraise: "rule" });
      expect(engine.runtime.mode()).toEqual({ appraise: "rule", render: "rule" });
      await engine.runtime.setMode({ render: "llm" });
      expect(engine.runtime.mode()).toEqual({ appraise: "rule", render: "llm" });
      expect(engine.info().mode).toEqual({ appraise: "rule", render: "llm" });
    } finally {
      await h.dispose();
    }
  });

  test("asking for what the engine cannot serve is refused and changes nothing", async () => {
    const llm = scriptedLlm();
    const h = await openRuleEngine({ models: { s1: llm.s1 }, mode: "judge-only" });
    try {
      const { engine } = h;
      await expect(engine.runtime.setMode("full")).rejects.toMatchObject({ code: "MODE_UNAVAILABLE" });
      await expect(engine.runtime.setMode({ render: "llm", s2Tier: "nope" })).rejects.toMatchObject({ code: "MODE_UNAVAILABLE" });
      await expect(engine.runtime.setMode({ appraise: "bogus" } as never)).rejects.toMatchObject({ code: "MODE_INVALID" });
      expect(engine.runtime.mode()).toEqual({ appraise: "llm", render: "rule" });
      expect(engine.runtime.pending()).toBeNull();
      expect(await eventsOf(engine, "runtime.mode_changed")).toHaveLength(0);
    } finally {
      await h.dispose();
    }
  });

  test("asking for the mode the engine is already in writes nothing", async () => {
    const h = await openRuleEngine();
    try {
      const { engine } = h;
      const sceneId = await startScene(engine);
      await playTurn(engine, sceneId, "hi");
      const before = (await eventsOf(engine, "runtime.mode_changed")).length;
      const change = await engine.runtime.setMode("rule");
      expect(change.before).toEqual(change.after);
      expect((await eventsOf(engine, "runtime.mode_changed")).length).toBe(before);
    } finally {
      await h.dispose();
    }
  });
});

describe("mode switching while a turn is running", () => {
  /** An S2 model whose render waits until the test lets it finish. */
  function gatedS2() {
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const inRender = new Promise<void>((r) => (entered = r));
    const llm = scriptedLlm({
      s2: async (req) => {
        if (req.label === "render") {
          entered();
          await gate;
        }
        return undefined;
      },
    });
    return { llm, release, inRender };
  }

  test("turn_boundary (default): the change is queued, the running turn keeps its backend, the next turn follows it", async () => {
    const { llm, release, inRender } = gatedS2();
    const h = await openRuleEngine({ models: { s1: llm.s1, s2: llm.s2 }, mode: "full" });
    try {
      const { engine } = h;
      expect(engine.runtime.switchAt).toBe("turn_boundary");
      const sceneId = await startScene(engine);
      const turn = playTurn(engine, sceneId, "first");
      await inRender;

      const change = await engine.runtime.setMode("rule", { trigger: "mid-turn" });
      expect(change.pending).toBe(true);
      expect(change.after).toEqual({ appraise: "rule", render: "rule" });
      // nothing has changed yet: the running turn and anyone asking now still see the old mode
      expect(engine.runtime.mode()).toEqual({ appraise: "llm", render: "llm" });
      expect(engine.runtime.pending()).toEqual({ appraise: "rule", render: "rule" });

      release();
      const first = await turn;
      expectValidTurn(first);
      expect(npcLine(first)).toContain("Hello from the model");

      // applied right after the turn
      expect(engine.runtime.mode()).toEqual({ appraise: "rule", render: "rule" });
      expect(engine.runtime.pending()).toBeNull();
      const second = await playTurn(engine, sceneId, "second");
      expectValidTurn(second);
      expect(npcLine(second)).not.toContain("Hello from the model");

      const rs = await routes(engine);
      expect(rs[0]!.render.backend).toBe("llm");
      expect(rs[1]!.render.backend).toBe("rule");
      const changes = (await eventsOf(engine, "runtime.mode_changed")) as unknown as Array<{ reason: string; trigger?: string }>;
      expect(changes.at(-1)).toMatchObject({ reason: "api", trigger: "mid-turn" });
    } finally {
      await h.dispose();
    }
  });

  test("a later request replaces the queued one; asking for the current mode withdraws it", async () => {
    const { llm, release, inRender } = gatedS2();
    const h = await openRuleEngine({ models: { s1: llm.s1, s2: llm.s2 }, mode: "full" });
    try {
      const { engine } = h;
      const sceneId = await startScene(engine);
      const turn = playTurn(engine, sceneId, "first");
      await inRender;
      await engine.runtime.setMode("rule");
      await engine.runtime.setMode("judge-only");
      expect(engine.runtime.pending()).toEqual({ appraise: "llm", render: "rule" });
      const back = await engine.runtime.setMode("full");
      expect(back.pending).toBe(false);
      expect(engine.runtime.pending()).toBeNull();
      release();
      await turn;
      expect(engine.runtime.mode()).toEqual({ appraise: "llm", render: "llm" });
      expect(await eventsOf(engine, "runtime.mode_changed")).toHaveLength(1);
    } finally {
      await h.dispose();
    }
  });

  test("switchAt: immediate applies at once; the running turn still finishes on the backend it began with", async () => {
    const { llm, release, inRender } = gatedS2();
    const h = await openRuleEngine({
      models: { s1: llm.s1, s2: llm.s2 },
      mode: "full",
      yaml: "runtime:\n  switchAt: immediate",
    });
    try {
      const { engine } = h;
      expect(engine.runtime.switchAt).toBe("immediate");
      const sceneId = await startScene(engine);
      const turn = playTurn(engine, sceneId, "first");
      await inRender;

      const change = await engine.runtime.setMode("rule");
      expect(change.pending).toBe(false);
      expect(engine.runtime.mode()).toEqual({ appraise: "rule", render: "rule" });
      expect(engine.runtime.pending()).toBeNull();

      release();
      const first = await turn;
      // the call that was in flight was not interrupted
      expect(npcLine(first)).toContain("Hello from the model");
      const second = await playTurn(engine, sceneId, "second");
      expect(npcLine(second)).not.toContain("Hello from the model");
      const rs = await routes(engine);
      expect(rs.map((r) => r.render.backend)).toEqual(["llm", "rule"]);
    } finally {
      await h.dispose();
    }
  });
});
