import { describe, expect, test } from "bun:test";
import type { PresetBundle } from "../../src/preset.ts";
import { eventsOf, npcLine } from "../helpers/rule-fixture.ts";
import { budgetPreset, openSessionEngine, playTurn, scriptedLlm } from "./session-fixture.ts";

type Route = {
  appraise: { backend: string };
  render: { backend: string; tier?: string };
  triggers: string[];
  escalated?: boolean;
  degraded?: string[];
  budget: { s1Calls: number; s2CallsByTier: Record<string, number> };
};
type Degraded = { kind_detail?: string; action?: string; from?: string; to?: string; reason?: string };

/** An appraisal that tags every line `secret`, so every turn raises the `secret_topic` trigger. */
function ambiguousS1() {
  return scriptedLlm({
    s1: (req) =>
      req.label === "appraise"
        ? {
            type: "other",
            intensity: 0.5,
            sincerity: 0.9,
            claims: [],
            search_terms: [],
            tags: ["secret"],
            input_class: "normal",
          }
        : undefined,
  });
}

function twoTierModels() {
  const s1 = scriptedLlm({ ids: { s1: "budget/s1" } });
  const std = scriptedLlm({ ids: { s2: "budget/std" } });
  const pro = scriptedLlm({ ids: { s2: "budget/pro" } });
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

/**
 * Room for one general escalation per scene: a pool of two slots, half of it reserved for anchors, no cap on the share
 * of escalated turns, and enough synchronous calls for an S1 + S2 turn. When the pool is used up the degrade list defers
 * reflection and keeps the render on the default tier.
 */
function escalationPreset(): PresetBundle {
  const base = budgetPreset();
  return {
    ...base,
    policies: [
      ...base.policies,
      {
        name: "session-escalation.yaml",
        doc: {
          router: {
            budget: { syncCallsPerTurn: 2, s2PerTurn: 1, s2Ratio: 1, sceneS2Pool: 2, s2ReservedForAnchors: 0.5 },
            degrade: ["defer_reflection", "s2_tier_down"],
          },
        },
      },
    ],
  };
}

describe("session budget and router triggers", () => {
  test("a synchronous-call cap below the number of LLM roles serves the render on rules, every turn", async () => {
    const llm = scriptedLlm();
    const h = await openSessionEngine({
      preset: budgetPreset(),
      models: { s1: llm.s1, s2: llm.s2 },
      mode: "full",
    });
    try {
      const sceneId = await h.engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      for (let i = 0; i < 3; i++) {
        const chunks = await playTurn(h.engine, sceneId, `line ${i}`);
        expect(npcLine(chunks).length).toBeGreaterThan(0);
      }
      const routes = (await eventsOf(h.engine, "route.decided")) as unknown as Route[];
      expect(routes).toHaveLength(3);
      for (const r of routes) {
        expect(r.appraise.backend).toBe("llm");
        expect(r.render.backend).toBe("rule");
        expect(r.degraded).toEqual(["s2_to_rule"]);
        expect(r.budget).toEqual({ s1Calls: 1, s2CallsByTier: {} });
      }
      const degraded = (await eventsOf(h.engine, "budget.degraded")) as unknown as Degraded[];
      expect(degraded.map((d) => [d.kind_detail, d.action, d.reason])).toEqual([
        ["plan", "s2_to_rule", "syncCallsPerTurn"],
        ["plan", "s2_to_rule", "syncCallsPerTurn"],
        ["plan", "s2_to_rule", "syncCallsPerTurn"],
      ]);
      // The S1 role still ran on the model; the S2 role never did.
      expect(llm.calls.s1.filter((label) => label === "appraise")).toHaveLength(3);
      expect(llm.calls.s2).toEqual([]);
      await h.engine.scene.end(sceneId);
      await h.audit({ snapshots: false });
    } finally {
      await h.dispose();
    }
  });

  test("scene escalation pool: the first secret turn escalates, the next one is refused and degrades", async () => {
    const t = twoTierModels();
    const s1 = ambiguousS1();
    const h = await openSessionEngine({
      preset: escalationPreset(),
      models: { s1: s1.s1, s2: t.models.s2 },
      mode: "full",
    });
    try {
      const sceneId = await h.engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      for (let i = 0; i < 3; i++) await playTurn(h.engine, sceneId, `line ${i}`);

      const routes = (await eventsOf(h.engine, "route.decided")) as unknown as Route[];
      expect(routes.map((r) => r.triggers.includes("secret_topic"))).toEqual([true, true, true]);
      expect(routes[0]).toMatchObject({ escalated: true, render: { backend: "llm", tier: "pro" } });
      expect(routes[0]!.degraded).toBeUndefined();
      for (const r of routes.slice(1)) {
        expect(r.escalated).toBeUndefined();
        expect(r.render).toMatchObject({ backend: "llm", tier: "std" });
        expect(r.degraded).toEqual(["defer_reflection", "s2_tier_down"]);
      }
      expect(t.pro.calls.s2).toHaveLength(1);
      expect(t.std.calls.s2).toHaveLength(2);

      const degraded = (await eventsOf(h.engine, "budget.degraded")) as unknown as Degraded[];
      expect(degraded.filter((d) => d.action === "s2_tier_down")).toHaveLength(2);
      for (const d of degraded.filter((x) => x.action === "s2_tier_down")) {
        expect(d).toMatchObject({ kind_detail: "route", from: "pro", to: "std", reason: "sceneS2Pool_general" });
      }
      await h.engine.scene.end(sceneId);
      await h.audit({ snapshots: false });
    } finally {
      await h.dispose();
    }
  });

  test("defer_reflection holds the reflection back at scene end and runs it at the next scene start", async () => {
    const t = twoTierModels();
    const s1 = ambiguousS1();
    const h = await openSessionEngine({
      preset: escalationPreset(),
      models: { s1: s1.s1, s2: t.models.s2 },
      mode: "full",
    });
    try {
      const scene1 = await h.engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      await playTurn(h.engine, scene1, "first line");
      await playTurn(h.engine, scene1, "second line");
      await h.engine.scene.end(scene1);

      expect(await eventsOf(h.engine, "reflection.proposed")).toHaveLength(0);
      const degraded = (await eventsOf(h.engine, "budget.degraded")) as unknown as Degraded[];
      expect(
        degraded.filter((d) => d.kind_detail === "side_job").map((d) => [d.action, d.from, d.to, d.reason]),
      ).toEqual([["defer_reflection", "llm", "deferred", "escalation_budget"]]);

      const scene2 = await h.engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      const flushed = await eventsOf(h.engine, "reflection.proposed");
      expect(flushed.map((e) => (e as unknown as { owner: string }).owner).sort()).toEqual(["npc1", "player"]);
      await h.engine.scene.end(scene2);
      await h.audit({ snapshots: false });
    } finally {
      await h.dispose();
    }
  });
});
