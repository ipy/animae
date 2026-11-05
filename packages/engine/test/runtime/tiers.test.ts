import { describe, expect, test } from "bun:test";
import { scriptedLlm, type ScriptedLlm } from "../helpers/llm-scripts.ts";
import { eventsOf, npcLine, openRuleEngine, playTurn, rulePreset, startScene } from "../helpers/rule-fixture.ts";

type Route = {
  render: { backend: string; tier?: string; model?: string };
  triggers: string[];
  escalated?: boolean;
  budget: { s1Calls: number; s2CallsByTier: Record<string, number> };
  degraded?: string[];
};
type Degraded = { action?: string; from?: string; to?: string; reason?: string };

/** Two S2 tiers behind one S1: `std` (default) and `pro` (the escalation tier). */
function twoTiers() {
  const s1 = scriptedLlm({ ids: { s1: "tier/s1" } });
  const std = scriptedLlm({ ids: { s2: "tier/std" } });
  const pro = scriptedLlm({ ids: { s2: "tier/pro" } });
  return {
    s1,
    std,
    pro,
    models: {
      s1: s1.s1,
      s2: {
        default: "std",
        tiers: [
          { id: "std", port: std.s2 },
          { id: "pro", port: pro.s2 },
        ],
        routing: { escalate_to: "pro" },
      },
    },
  };
}

/** S1 answers `other` (which fires the router's `ambiguity` trigger) on the calls `when` accepts, `chat` otherwise. */
function ambiguousS1(when: (n: number) => boolean): ScriptedLlm {
  return scriptedLlm({
    ids: { s1: "tier/s1" },
    s1: (req, n) =>
      req.label === "appraise"
        ? {
            type: when(n) ? "other" : "chat",
            intensity: 0.5,
            sincerity: 0.9,
            claims: [],
            search_terms: [],
            tags: [],
            input_class: "normal",
          }
        : undefined,
  });
}

function renders(llm: ScriptedLlm): number {
  return llm.calls.s2.filter((l) => l === "render").length;
}

describe("S2 tiers through the engine", () => {
  test("the models the engine reports are the configured tiers", async () => {
    const t = twoTiers();
    const h = await openRuleEngine({ models: t.models, mode: "full" });
    try {
      const info = h.engine.info().models;
      expect(info.s2Tiers.map((x) => x.id)).toEqual(["std", "pro"]);
      expect(info).toMatchObject({ s1: "tier/s1", s2: "tier/std", s2Default: "std", s2Escalate: "pro", s1Llm: true });
    } finally {
      await h.dispose();
    }
  });

  test("without a trigger every render runs on the default tier", async () => {
    const t = twoTiers();
    const h = await openRuleEngine({ models: t.models, mode: "full" });
    try {
      const sceneId = await startScene(h.engine);
      for (let i = 0; i < 3; i++) await playTurn(h.engine, sceneId, `line ${i}`);
      expect(renders(t.std)).toBe(3);
      expect(renders(t.pro)).toBe(0);
      const routes = (await eventsOf(h.engine, "route.decided")) as unknown as Route[];
      for (const r of routes) {
        expect(r.render).toMatchObject({ backend: "llm", tier: "std", model: "tier/std" });
        expect(r.triggers).toEqual([]);
        expect(r.escalated).toBeFalsy();
      }
    } finally {
      await h.dispose();
    }
  });

  test("a trigger sends that turn's render to escalate_to; the next turn is back on the default tier", async () => {
    const t = twoTiers();
    const s1 = ambiguousS1((n) => n === 1);
    const h = await openRuleEngine({
      models: { s1: s1.s1, s2: t.models.s2 },
      mode: "full",
      preset: rulePreset({ router: { budget: { s2Ratio: 1, sceneS2Pool: 3 } } }),
    });
    try {
      const sceneId = await startScene(h.engine);
      const first = await playTurn(h.engine, sceneId, "first line");
      const second = await playTurn(h.engine, sceneId, "second line");
      // the turn the trigger fired on was spoken by the high tier
      expect(npcLine(first)).toContain("Hello from the model");
      expect(renders(t.pro)).toBe(1);
      expect(renders(t.std)).toBe(1);
      expect(npcLine(second)).toContain("Hello from the model");

      const routes = (await eventsOf(h.engine, "route.decided")) as unknown as Route[];
      expect(routes[0]).toMatchObject({
        render: { tier: "pro", model: "tier/pro" },
        triggers: ["ambiguity"],
        escalated: true,
        budget: { s1Calls: 1, s2CallsByTier: { pro: 1 } },
      });
      expect(routes[1]).toMatchObject({ render: { tier: "std" }, triggers: [] });
      expect(routes[1]!.escalated).toBeFalsy();
    } finally {
      await h.dispose();
    }
  });

  test("when the escalation budget is spent the render tiers down and the event says from what to what", async () => {
    // S1 calls every line `other`, which fires the ambiguity trigger every turn. The scene pool holds two slots and one of
    // them is kept back for anchors, so exactly one escalation is allowed.
    const t = twoTiers();
    const s1 = ambiguousS1(() => true);
    const h = await openRuleEngine({
      models: { s1: s1.s1, s2: t.models.s2 },
      mode: "full",
      preset: rulePreset({ router: { budget: { s2Ratio: 1, sceneS2Pool: 2 } } }),
    });
    try {
      const sceneId = await startScene(h.engine);
      for (let i = 0; i < 4; i++) {
        const chunks = await playTurn(h.engine, sceneId, `line ${i}`);
        // a spent budget never stops the game: every turn still has an NPC line
        expect(npcLine(chunks).length).toBeGreaterThan(0);
      }
      expect(renders(t.pro)).toBe(1);
      expect(renders(t.std)).toBe(3);
      const routes = (await eventsOf(h.engine, "route.decided")) as unknown as Route[];
      expect(routes.map((r) => r.render.tier)).toEqual(["pro", "std", "std", "std"]);
      expect(routes.map((r) => r.triggers.includes("ambiguity"))).toEqual([true, true, true, true]);
      expect(routes[0]!.escalated).toBe(true);
      for (const r of routes.slice(1)) {
        expect(r.escalated).toBeFalsy();
        expect(r.degraded).toContain("s2_tier_down");
      }
      const degraded = (await eventsOf(h.engine, "budget.degraded")) as unknown as Degraded[];
      expect(degraded).toHaveLength(3);
      for (const d of degraded) expect(d).toMatchObject({ action: "s2_tier_down", from: "pro", to: "std" });
      expect(degraded[0]!.reason).toMatch(/sceneS2Pool|s2Ratio/);
    } finally {
      await h.dispose();
    }
  });

  test("s2_to_rule first in the degrade list: the spent budget hands the render to the rule backend", async () => {
    const t = twoTiers();
    const s1 = ambiguousS1(() => true);
    const h = await openRuleEngine({
      models: { s1: s1.s1, s2: t.models.s2 },
      mode: "full",
      preset: rulePreset({
        router: { budget: { s2Ratio: 1, sceneS2Pool: 0 }, degrade: ["s2_to_rule", "s2_tier_down"] },
      }),
    });
    try {
      const sceneId = await startScene(h.engine);
      const chunks = await playTurn(h.engine, sceneId, "hello there");
      expect(npcLine(chunks)).toBe("Aria nods: hello there");
      expect(renders(t.std) + renders(t.pro)).toBe(0);
      const routes = (await eventsOf(h.engine, "route.decided")) as unknown as Route[];
      expect(routes[0]!.render).toEqual({ backend: "rule" });
      const degraded = (await eventsOf(h.engine, "budget.degraded")) as unknown as Degraded[];
      expect(degraded[0]).toMatchObject({ action: "s2_to_rule", to: "rule" });
    } finally {
      await h.dispose();
    }
  });

  test("setMode can pin sync renders to a tier, and unknown tiers are refused", async () => {
    const t = twoTiers();
    const h = await openRuleEngine({ models: t.models, mode: "full" });
    try {
      const { engine } = h;
      await expect(engine.runtime.setMode({ s2Tier: "nope" })).rejects.toMatchObject({ code: "MODE_UNKNOWN_TIER" });
      await engine.runtime.setMode({ s2Tier: "pro" });
      expect(engine.runtime.mode()).toEqual({ appraise: "llm", render: "llm", s2Tier: "pro" });
      const sceneId = await startScene(engine);
      await playTurn(engine, sceneId, "hello");
      expect(renders(t.pro)).toBe(1);
      expect(renders(t.std)).toBe(0);
      const route = (await eventsOf(engine, "route.decided"))[0] as unknown as Route;
      expect(route.render).toMatchObject({ tier: "pro" });
      // a tier only means something while S2 runs on a model: it is dropped when the render goes to rules
      await engine.runtime.setMode({ render: "rule" });
      expect(engine.runtime.mode()).toEqual({ appraise: "llm", render: "rule" });
    } finally {
      await h.dispose();
    }
  });

  test("a single S2 model is one tier named `only`, which the footer never has to show", async () => {
    const llm = scriptedLlm();
    const h = await openRuleEngine({ models: { s1: llm.s1, s2: llm.s2 }, mode: "full" });
    try {
      const info = h.engine.info().models;
      expect(info.s2Tiers.map((x) => x.id)).toEqual(["only"]);
      const sceneId = await startScene(h.engine);
      await playTurn(h.engine, sceneId, "hello");
      const route = (await eventsOf(h.engine, "route.decided"))[0] as unknown as Route;
      expect(route.render).toMatchObject({ tier: "only", model: "llm/s2" });
    } finally {
      await h.dispose();
    }
  });
});
