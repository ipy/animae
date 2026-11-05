import { describe, expect, test } from "bun:test";
import {
  createRpcLineSession,
  ExplainResultSchema,
  InfoResultSchema,
  ModsResultSchema,
  openRpcRuleEngine,
  SceneReportSchema,
  SceneTurnResultSchema,
} from "./rpc-fixture.ts";

describe("JSON-RPC session e2e (spec 20–21, rpc-reference)", () => {
  test("info → scene.start → scene.turn stream → query → explain → timeline → locale → display → entities → mods", async () => {
    const h = await openRpcRuleEngine({ mode: "rule" });
    const rpc = createRpcLineSession(h.engine);
    try {
      const infoMsg = await rpc.call("info");
      expect(infoMsg.error).toBeUndefined();
      InfoResultSchema.parse(infoMsg.result);

      const startMsg = await rpc.call("scene.start", { location: "tavern", participants: ["player", "npc1"] });
      expect(startMsg.error).toBeUndefined();
      const sceneId = startMsg.result as string;
      expect(sceneId).toMatch(/^scn_/);

      const turnId = rpc.send("scene.turn", { sceneId, actor: "player", text: "hello there", addressee: "npc1", outputLocale: "en" });
      const turnMsg = await rpc.response(turnId);
      expect(turnMsg.error).toBeUndefined();
      const turnResult = SceneTurnResultSchema.parse(turnMsg.result);
      expect(turnResult.events.length).toBeGreaterThan(0);

      const chunks = rpc.chunksFor(turnId);
      expect(chunks.length).toBeGreaterThan(0);
      const types = chunks.map((c) => c.type);
      expect(types).toContain("done");
      const textIdx = types.indexOf("text");
      const doneIdx = types.lastIndexOf("done");
      if (textIdx >= 0 && doneIdx >= 0) expect(textIdx).toBeLessThan(doneIdx);

      const queryMsg = await rpc.call("query", { viewer: "player", path: "world/location" });
      expect(queryMsg.error).toBeUndefined();

      const explainMsg = await rpc.call("explain", {
        turnId: turnResult.summary?.turnId ?? turnResult.events[0]!,
        viewer: "player",
      });
      expect(explainMsg.error).toBeUndefined();
      ExplainResultSchema.parse(explainMsg.result);

      const current = await rpc.call("timeline.current");
      expect(current.error).toBeUndefined();

      const saves = await rpc.call("timeline.saves");
      expect(saves.error).toBeUndefined();

      const events = await rpc.call("timeline.events", { opts: { limit: 5 } });
      expect(events.error).toBeUndefined();

      const locale = await rpc.call("setUiLocale", { locale: "en" });
      expect(locale.error).toBeUndefined();
      expect(locale.result).toBeNull();

      const resolved = await rpc.call("display.resolve", { value: "plain string" });
      expect(resolved.error).toBeUndefined();

      const displayName = await rpc.call("display.entityDisplayName", { entityId: "npc1", opts: { viewer: "player" } });
      expect(displayName.error).toBeUndefined();
      expect(typeof displayName.result).toBe("string");

      const modsMsg = await rpc.call("mods");
      expect(modsMsg.error).toBeUndefined();
      ModsResultSchema.parse(modsMsg.result);

      const aliasMsg = await rpc.call("entities.setAlias", {
        input: { entity: "npc1", alias: "Aria-the-bard", by: "player" },
      });
      expect(aliasMsg.error).toBeUndefined();

      const spawnMsg = await rpc.call("entities.spawn", {
        spec: {
          kind: "character",
          id: "extra_npc",
          card: {
            identity: { name: "Extra", summary: "Visitor", style_examples: [] },
            constraints: { motives: [], bottom_lines: [], taboos: [] },
            lod: "extra",
            tags: [],
          },
          persona: "A guest.",
          traits: { event_mult: {} },
          tracks: { self: {}, toward: {}, overrides: {} },
          goals: [],
          secrets: [],
          relations: [],
          knowledge: [],
        },
      });
      expect(spawnMsg.error).toBeUndefined();

      const spawnLocMsg = await rpc.call("entities.spawn", {
        spec: { kind: "location", id: "cellar", name: "Wine cellar", summary: "Damp.", tags: [], connects: [], vars: {} },
      });
      expect(spawnLocMsg.error).toBeUndefined();
      expect(spawnLocMsg.result).toEqual({ kind: "location", id: "cellar" });
      const cellar = await rpc.call("query", { viewer: "debug", path: "world/locations/cellar" });
      expect(cellar.error).toBeUndefined();
      expect(cellar.result).toMatchObject({ id: "cellar", name: "Wine cellar", summary: "Damp." });

      const briefMsg = await rpc.call("entities.generateFromBrief", {
        brief: { kind: "character", archetype: "wanderer", tags: [], avoidNames: [] },
        opts: { pools: { names: ["Pat", "Quinn"] }, reason: "rpc-e2e" },
      });
      expect(briefMsg.error).toBeUndefined();

      const retireMsg = await rpc.call("entities.retire", { ref: "extra_npc", opts: { reason: "e2e cleanup" } });
      expect(retireMsg.error).toBeUndefined();

      const endMsg = await rpc.call("scene.end", { sceneId });
      expect(endMsg.error).toBeUndefined();
      SceneReportSchema.parse(endMsg.result);

      void startMsg;
      void current;
      void saves;
      void events;
    } finally {
      await rpc.close();
      await h.dispose();
    }
  });
});
