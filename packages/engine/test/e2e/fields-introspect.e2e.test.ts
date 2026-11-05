import { describe, expect, test } from "bun:test";
import {
  careScriptedLlm,
  introspectPreset,
  openFieldsEngine,
  playFieldsTurn,
} from "./fields-fixture.ts";

describe("fields introspection e2e", () => {
  test("query viewers, custom registerViewer, queryAsync catch-up, explain chain", async () => {
    const llm = careScriptedLlm();
    const h = await openFieldsEngine({
      preset: introspectPreset(),
      models: { s1: llm.s1, s2: llm.s2 },
      mode: "full",
      onOpen: (engine) => {
        engine.introspect.registerViewer({
          id: "redactor",
          extends: "player",
          filter: (path, value) => {
            if (path === "world/vars" && value && typeof value === "object") {
              const copy = { ...(value as Record<string, unknown>) };
              delete copy.hidden;
              return copy;
            }
            if (path === "characters/npc1/memory") return undefined;
            return value;
          },
        });
      },
    });
    try {
      await h.engine.world.advance({ to: { day: 1, minute: 510 } });
      const beforeOffscreen = (await h.engine.timeline.events({ kinds: ["offscreen.simulated"] })).length;
      h.engine.query("player", "world/locations/tavern");
      expect((await h.engine.timeline.events({ kinds: ["offscreen.simulated"] })).length).toBe(beforeOffscreen);
      await h.engine.queryAsync("player", "world/locations/tavern");
      expect((await h.engine.timeline.events({ kinds: ["offscreen.simulated"] })).length).toBeGreaterThan(
        beforeOffscreen,
      );

      const playerVars = h.engine.query("player", "world/vars") as Record<string, unknown>;
      expect(playerVars.gold).toBe(5);
      expect(playerVars.hidden).toBeUndefined();
      const debugVars = h.engine.query("debug", "world/vars") as Record<string, unknown>;
      expect(debugVars.hidden).toBe(99);
      const redactorVars = h.engine.query("redactor", "world/vars") as Record<string, unknown>;
      expect(redactorVars.gold).toBe(5);
      expect(redactorVars.hidden).toBeUndefined();

      const sceneId = await h.engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      await playFieldsTurn(h.engine, sceneId, "where is the gem?");
      const utterance = (await h.engine.timeline.events({ kinds: ["utterance"] })).slice(-1)[0] as
        | { retrieval?: { id: string; score: number }[]; turn?: string }
        | undefined;
      expect((utterance?.retrieval ?? []).length).toBeGreaterThan(0);
      const turnId = utterance?.turn;
      expect(typeof turnId).toBe("string");

      const playerEx = h.engine.explain(turnId!, "player");
      const debugEx = h.engine.explain(turnId!, "debug");
      const kindsPlayer = playerEx.chain.map((c) => c.kind);
      expect(kindsPlayer.indexOf("check.rolled")).toBeLessThan(kindsPlayer.indexOf("track.delta"));
      expect(kindsPlayer.indexOf("track.delta")).toBeLessThan(kindsPlayer.indexOf("route.decided"));
      expect(kindsPlayer.indexOf("route.decided")).toBeLessThan(kindsPlayer.indexOf("utterance"));
      const retrievalPlayer = playerEx.chain.filter((c) => c.kind === "retrieval");
      expect(retrievalPlayer.length).toBeGreaterThan(0);
      for (const item of retrievalPlayer) {
        expect((item.data as { text?: string }).text).toBeUndefined();
      }
      const retrievalDebug = debugEx.chain.filter((c) => c.kind === "retrieval");
      expect(retrievalDebug[0]?.data).toMatchObject({
        id: utterance!.retrieval![0]!.id,
        score: utterance!.retrieval![0]!.score,
      });
      const debugUtterance = debugEx.chain.find((c) => c.kind === "utterance");
      expect((debugUtterance?.data as { retrieval?: unknown[] })?.retrieval?.length).toBe(
        utterance!.retrieval!.length,
      );
      const privateDebugHit = retrievalDebug.find((c) => (c.data as { id?: string }).id === "mem_npc1_private");
      // The memory text survives the writes that follow retrieval within the turn (the sync cache stays warm).
      expect(privateDebugHit).toBeDefined();
      expect((privateDebugHit!.data as { text?: string }).text).toContain("Private gem");
      const privatePlayerHit = retrievalPlayer.find((c) => (c.data as { id?: string }).id === "mem_npc1_private");
      expect(privatePlayerHit).toBeDefined();
      expect((privatePlayerHit!.data as { text?: string }).text).toBeUndefined();

      // `player` may read `characters/npc1`, but the explicit deny on `characters/npc1/memory` wins over that allow.
      expect(h.engine.query("player", "characters/npc1/memory")).toBeUndefined();
      expect(h.engine.query("player", "characters/npc1/identity")).toBeDefined();
      expect(h.engine.query("redactor", "characters/npc1/memory")).toBeUndefined();

      await h.engine.scene.end(sceneId);
      await h.audit({ snapshots: false });
    } finally {
      await h.dispose();
    }
  });
});
