import { describe, expect, test } from "bun:test";
import { createScriptedModel } from "../../src/model/scripted.ts";
import { fieldDef, openFieldsEngine, playFieldsTurn, trackCapsPreset } from "./fields-fixture.ts";

function careOnlyModels() {
  const handler = (req: { label?: string }) => {
    if (req.label === "appraise") {
      return {
        type: "care",
        intensity: 0.95,
        sincerity: 0.95,
        claims: [],
        search_terms: [],
        tags: [],
        input_class: "normal",
      };
    }
    return { text: "ok", cues: [], intent_realized: "talk" };
  };
  return {
    s1: createScriptedModel("caps/s1", handler),
    s2: createScriptedModel("caps/s2", handler),
  };
}

describe("fields track_caps e2e", () => {
  test("intersecting caps clamp affinity; revoke lifts cap; no cross-character leak", async () => {
    const models = careOnlyModels();
    const h = await openFieldsEngine({ preset: trackCapsPreset(), models, mode: "full" });
    try {
      const sceneNpc1 = await h.engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      await h.engine.fields.grant(
        fieldDef({
          id: "cap_a",
          level: "L1",
          priority: 1,
          effects: { track_caps: { affinity: { min: 52, max: 58 } } },
        }),
      );
      await h.engine.fields.grant(
        fieldDef({
          id: "cap_b",
          level: "L1",
          priority: 2,
          stacking: "add",
          effects: { track_caps: { affinity: { min: 54, max: 56 } } },
        }),
      );

      for (let i = 0; i < 4; i++) {
        await playFieldsTurn(h.engine, sceneNpc1, `push affinity ${i}`);
      }
      const deltas = (await h.engine.timeline.events({ kinds: ["track.delta"] })).filter(
        (e) => (e as { track?: string }).track === "affinity",
      ) as { after?: number; delta?: number }[];
      expect(deltas.length).toBeGreaterThan(0);
      for (const d of deltas) {
        expect(d.after!).toBeLessThanOrEqual(56);
        expect(d.after!).toBeGreaterThanOrEqual(54);
      }
      const tracks = h.engine.query("debug", "characters/npc1/tracks") as {
        toward?: Record<string, Record<string, number>>;
      };
      expect(tracks.toward?.player?.affinity).toBeLessThanOrEqual(56);

      await h.engine.fields.revoke("cap_a");
      await h.engine.fields.revoke("cap_b");
      await playFieldsTurn(h.engine, sceneNpc1, "after caps removed");
      const afterRevoke = (await h.engine.timeline.events({ kinds: ["track.delta"] })).filter(
        (e) => (e as { track?: string }).track === "affinity",
      ) as { after?: number }[];
      const last = afterRevoke.at(-1);
      expect(last?.after).toBeGreaterThan(56);

      await h.engine.scene.end(sceneNpc1);

      const sceneNpc2 = await h.engine.scene.start({ location: "tavern", participants: ["player", "npc2"] });
      await h.engine.fields.grant(
        fieldDef({
          id: "cap_npc1_only",
          holder: { kind: "character", ref: "npc1" },
          level: "L1",
          effects: { track_caps: { affinity: { max: 50 } } },
        }),
      );
      for (let i = 0; i < 3; i++) {
        await playFieldsTurn(h.engine, sceneNpc2, `npc2 line ${i}`, { addressee: "npc2" });
      }
      const npc2Deltas = (await h.engine.timeline.events({ kinds: ["track.delta"] })).filter(
        (e) => (e as { owner?: string; track?: string }).owner === "npc2" && (e as { track?: string }).track === "affinity",
      ) as { after?: number }[];
      if (npc2Deltas.length > 0) {
        expect(npc2Deltas.at(-1)?.after).toBeGreaterThan(50);
      }
      await h.engine.scene.end(sceneNpc2);
      await h.audit({ snapshots: false });
    } finally {
      await h.dispose();
    }
  });
});
