import { test, expect, describe } from "bun:test";
import { buildCelContext } from "../../src/rules/cel-context.ts";
import { createCelEngine } from "../../src/rules/cel.ts";
import { scoreMemoryEntry } from "../../src/memory/retrieval.ts";
import { applyPolicyDefaults } from "../../src/policy/defaults.ts";
import { entityRefForQueryCatchUp } from "../../src/introspect/query-catchup.ts";
import { createFakeKernel } from "../world/fake-kernel.ts";
import { createIntrospect } from "../../src/introspect/service.ts";
import { preflightPlayerCatchUp } from "../../src/introspect/query-catchup.ts";
import { createPipelineKernel } from "../pipeline/test-kernel.ts";
import { runTurn } from "../../src/pipeline/run-turn.ts";
import { HookRegistry } from "../../src/pipeline/hooks.ts";
import { createScriptedModel } from "../../src/model/scripted.ts";
import type { Kernel } from "../../src/contracts.ts";

describe("§7.2 CEL context variables", () => {
  test("all spec roots are present and usable in CEL", () => {
    const policy = applyPolicyDefaults({});
    const { k } = createPipelineKernel({});
    const ctx = buildCelContext(
      { state: k.timeline.state(), authored: k.authored, policy, catalog: k.catalog },
      {
        self: "npc1",
        other: "player",
        actor: "player",
        sceneId: "scn_0001",
        event: { type: "care", intensity: 0.5, sincerity: 1, tags: [], claims: [], input_class: "normal" },
        check: { success: true, total: 15, margin: 5, dc: 10 },
      },
    );
    for (const key of ["self", "other", "actor", "event", "scene", "world", "time", "tracks", "tiers", "memory", "fields", "check"]) {
      expect(ctx).toHaveProperty(key);
    }
    const cel = createCelEngine();
    expect(cel.bool("check.success && check.total == 15 && check.margin == 5", ctx)).toBe(true);
    expect(cel.bool("memory.count >= 0 && fields.active != null", ctx)).toBe(true);
  });
});

describe("§9.3 retrieval weights", () => {
  test("default weights 0.5/0.2/0.2/0.1 and K=8 policy default", () => {
    const policy = applyPolicyDefaults({});
    expect(policy.memory.k).toBe(8);
    const w = policy.memory.weights!;
    expect(w.term).toBe(0.5);
    expect(w.recency).toBe(0.2);
    expect(w.importance).toBe(0.2);
    expect(w.salience).toBe(0.1);
    expect(w.vector).toBe(0.3);
    const score = scoreMemoryEntry(
      {
        id: "m1",
        t: { day: 1, minute: 0 },
        kind: "episodic",
        text: "hello world",
        tags: [],
        claims: [],
        importance: 1,
        valence: 0,
        branch: "main",
      },
      ["hello"],
      { day: 1, minute: 0 },
      policy,
    );
    expect(score).toBeCloseTo(0.5 + 0.2 + 0.2, 5);
  });
});

describe("§12.6 query-triggered catch-up", () => {
  test("entityRefForQueryCatchUp maps player character and location paths", () => {
    expect(entityRefForQueryCatchUp("player", "characters/npc1/tracks")).toEqual({ kind: "character", id: "npc1" });
    expect(entityRefForQueryCatchUp("player", "world/locations/tavern")).toEqual({ kind: "location", id: "tavern" });
    expect(entityRefForQueryCatchUp("gm", "characters/npc1")).toBeNull();
  });

  test("preflightPlayerCatchUp emits offscreen.simulated for stale location", async () => {
    const fk = createFakeKernel({
      policyLayer: {
        visibility: { rules: [{ viewer: "player", path: "world/locations/**", allow: true }] },
      },
    });
    fk.reloadState({
      ...fk.state(),
      locations: { ...fk.state().locations, tavern: { ...fk.state().locations.tavern!, lastSimulated: { day: 1, minute: 0 } } },
      time: { day: 1, minute: 80 },
    });
    await preflightPlayerCatchUp(fk.k, "player", "world/locations/tavern");
    expect(fk.events().some((e) => e.kind === "offscreen.simulated")).toBe(true);
    const intro = createIntrospect(fk.k);
    const loc = intro.query("player", "world/locations/tavern") as { lastSimulated: { day: number; minute: number } };
    expect(loc.lastSimulated).toEqual({ day: 1, minute: 80 });
  });
});

describe("§8 sync LLM calls per turn", () => {
  test("S1 turn: exactly appraise + render (no reflect/narrate)", async () => {
    const labels: string[] = [];
    const handler = (req: { label?: string }) => {
      labels.push(req.label ?? "?");
      if (req.label === "appraise") {
        return {
          type: "chat",
          intensity: 0.5,
          sincerity: 1,
          claims: [],
          search_terms: [],
          tags: [],
          input_class: "normal",
        };
      }
      return { text: "hi", cues: [], intent_realized: "respond" };
    };
    const { k, setState } = createPipelineKernel({
      s1Handler: handler,
      s2Handler: handler,
    });
    k.models.s1 = createScriptedModel("count/s1", handler);
    k.models.s2 = createScriptedModel("count/s2", handler);
    k.m.entities = {
      checkPromotions: async () => undefined,
      generate: async () => ({ kind: "character", id: "x" }),
      promote: async () => undefined,
    } as unknown as Kernel["m"]["entities"];

    setState({
      ...k.timeline.state(),
      scene: {
        id: "scn_0001",
        location: "loc",
        participants: ["player", "npc1"],
        turn: 2,
        startedAt: { day: 1, minute: 0 },
        fields: [],
      },
      sceneCount: 2,
    });

    const hooks = new HookRegistry();
    const gen = runTurn(k, hooks, {
      turnId: "turn_sync",
      sceneId: "scn_0001",
      actor: "player",
      addressee: "npc1",
      speaker: "npc1",
      text: "hello",
    });
    while (!(await gen.next()).done) {
      /* drain */
    }
    const syncLabels = labels.filter((l) => l === "appraise" || l === "render");
    expect(labels.filter((l) => l === "appraise").length).toBe(1);
    expect(labels.filter((l) => l === "render").length).toBe(1);
    expect(labels.filter((l) => l === "reflect").length).toBe(0);
    expect(syncLabels.length).toBe(2);
  });
});
