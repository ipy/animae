import { describe, expect, test } from "bun:test";
import { createScriptedModel } from "../../src/model/scripted.ts";
import {
  fieldsPreset,
  openFieldsEngine,
  playFieldsTurn,
  secretTrustPreset,
  seedSecretTrustAuthored,
} from "./fields-fixture.ts";

type RouteRow = {
  triggers?: string[];
  render?: { tier?: string; backend?: string };
  escalated?: boolean;
};

function taggedModels(tags: string[]) {
  const handler = (req: { label?: string }) => {
    if (req.label === "appraise") {
      return {
        type: "chat",
        intensity: 0.55,
        sincerity: 0.9,
        claims: [],
        search_terms: [],
        tags,
        input_class: "normal",
      };
    }
    return { text: "ok", cues: [], intent_realized: "talk" };
  };
  const s1 = createScriptedModel("secret/s1", handler);
  const std = createScriptedModel("secret/std", handler);
  const pro = createScriptedModel("secret/pro", handler);
  return {
    s1,
    s2: {
      default: "std",
      tiers: [
        { id: "std", port: std },
        { id: "pro", port: pro },
      ],
      routing: { escalate_to: "pro" },
    },
  };
}

const routerPreset = (base: typeof fieldsPreset | typeof secretTrustPreset) =>
  base({
    router: {
      triggers: { secret_topic: { enabled: true }, scene_first: { enabled: true } },
      budget: {
        syncCallsPerTurn: 4,
        s2PerTurn: 2,
        s2Ratio: 1,
        s2ReservedForAnchors: 0,
        maxOutputTokens: { s1: 400, s2: 800 },
      },
    },
  });

describe("fields secrets and secret_topic router e2e", () => {
  test("locked secret tags and literal secret trigger route.decided; addressee without secrets does not", async () => {
    const secretPreset = routerPreset(fieldsPreset);
    const models = taggedModels(["heirloom"]);
    const h = await openFieldsEngine({ preset: secretPreset, models: { s1: models.s1, s2: models.s2 }, mode: "full" });
    try {
      const sceneId = await h.engine.scene.start({ location: "tavern", participants: ["player", "npc1", "npc2"] });
      await playFieldsTurn(h.engine, sceneId, "ask about the ring");
      const routesNpc1 = (await h.engine.timeline.events({ kinds: ["route.decided"] })) as RouteRow[];
      expect(routesNpc1[0]?.triggers).toContain("secret_topic");
      expect(routesNpc1[0]?.escalated).toBe(true);
      expect(routesNpc1[0]?.render?.tier).toBe("pro");

      await playFieldsTurn(h.engine, sceneId, "ben question", { addressee: "npc2" });
      const routesNpc2Heirloom = (await h.engine.timeline.events({ kinds: ["route.decided"] })).slice(-1)[0] as RouteRow;
      expect(routesNpc2Heirloom?.triggers ?? []).not.toContain("secret_topic");

      const modelsSecret = taggedModels(["secret"]);
      const h2 = await openFieldsEngine({
        preset: secretPreset,
        models: { s1: modelsSecret.s1, s2: modelsSecret.s2 },
        mode: "full",
      });
      try {
        const sc2 = await h2.engine.scene.start({ location: "tavern", participants: ["player", "npc2"] });
        await playFieldsTurn(h2.engine, sc2, "whisper", { addressee: "npc2" });
        const routeLiteral = (await h2.engine.timeline.events({ kinds: ["route.decided"] })).slice(-1)[0] as RouteRow;
        expect(routeLiteral?.triggers).toContain("secret_topic");
        await h2.audit({ snapshots: false });
      } finally {
        await h2.dispose();
      }

      await h.engine.scene.end(sceneId);
      await h.audit({ snapshots: false });
    } finally {
      await h.dispose();
    }
  });

  test("runtime unlock clears secret_topic for that tag; sibling locked tag still escalates", async () => {
    const secretPreset = routerPreset(secretTrustPreset);
    let appraiseN = 0;
    const mixedS1 = createScriptedModel("secret/mixed-s1", (req) => {
      if (req.label !== "appraise") return undefined;
      appraiseN += 1;
      if (appraiseN === 1) {
        return {
          type: "chat",
          intensity: 0.55,
          sincerity: 0.9,
          claims: [],
          search_terms: [],
          tags: ["heirloom"],
          input_class: "normal",
        };
      }
      if (appraiseN === 2) {
        return {
          type: "care",
          intensity: 0.85,
          sincerity: 0.95,
          claims: [],
          search_terms: [],
          tags: [],
          input_class: "normal",
        };
      }
      if (appraiseN === 3) {
        return {
          type: "chat",
          intensity: 0.55,
          sincerity: 0.9,
          claims: [],
          search_terms: [],
          tags: ["heirloom"],
          input_class: "normal",
        };
      }
      return {
        type: "chat",
        intensity: 0.55,
        sincerity: 0.9,
        claims: [],
        search_terms: [],
        tags: ["vault"],
        input_class: "normal",
      };
    });
    const std = createScriptedModel("secret/mixed-std", () => ({ text: "ok", cues: [], intent_realized: "talk" }));
    const models = {
      s1: mixedS1,
      s2: {
        default: "std",
        tiers: [{ id: "std", port: std }, { id: "pro", port: std }],
        routing: { escalate_to: "pro" },
      },
    };
    const h = await openFieldsEngine({
      preset: secretPreset,
      authoredSeed: seedSecretTrustAuthored,
      models,
      mode: "full",
    });
    try {
      const sceneId = await h.engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      await playFieldsTurn(h.engine, sceneId, "ask about the ring");
      expect(
        ((await h.engine.timeline.events({ kinds: ["route.decided"] }))[0] as RouteRow)?.triggers,
      ).toContain("secret_topic");

      await playFieldsTurn(h.engine, sceneId, "show trust with care");
      expect((await h.engine.timeline.events({ kinds: ["character.secret_unlocked"] })).length).toBe(1);

      await playFieldsTurn(h.engine, sceneId, "ring again after unlock");
      const afterUnlock = (await h.engine.timeline.events({ kinds: ["route.decided"] })).slice(-1)[0] as RouteRow;
      expect(afterUnlock?.triggers ?? []).not.toContain("secret_topic");

      await playFieldsTurn(h.engine, sceneId, "the vault");
      const vaultRoute = (await h.engine.timeline.events({ kinds: ["route.decided"] })).slice(-1)[0] as RouteRow;
      expect(vaultRoute?.triggers).toContain("secret_topic");

      await h.engine.scene.end(sceneId);
      await h.audit({ snapshots: false });
    } finally {
      await h.dispose();
    }
  });
});
