import { describe, expect, test } from "bun:test";
import { stableStringify } from "../../src/store/util.ts";
import {
  careScriptedLlm,
  fieldDef,
  fieldsPreset,
  openFieldsEngine,
  playFieldsTurn,
  promptBlob,
} from "./fields-fixture.ts";

describe("fields effects e2e", () => {
  test("L0–L4 consumption, stacking, expiry, grant/revoke, determinism", async () => {
    const renderBodies: string[] = [];
    const llm = careScriptedLlm({ captureRender: (req) => renderBodies.push(promptBlob(req)) });

    const baseline = await openFieldsEngine({
      preset: fieldsPreset(),
      models: { s1: llm.s1, s2: llm.s2 },
      mode: "full",
    });
    const boosted = await openFieldsEngine({
      preset: fieldsPreset(),
      models: { s1: llm.s1, s2: llm.s2 },
      mode: "full",
    });
    try {
      const sceneBase = await baseline.engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      await playFieldsTurn(baseline.engine, sceneBase, "baseline care");
      const baseCheck = (await baseline.engine.timeline.events({ kinds: ["check.rolled"] }))[0] as
        | { total?: number; modifier?: number }
        | undefined;
      expect(baseCheck?.total).toBeDefined();
      const baseIntent = (await baseline.engine.timeline.events({ kinds: ["intent.decided"] }))[0] as
        | { intent?: string }
        | undefined;
      expect(baseIntent?.intent).toBe("talk");

      const sceneFx = await boosted.engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      await boosted.engine.fields.grant(
        fieldDef({
          id: "check_boost",
          level: "L1",
          effects: { check_mod: { "*": { bonus: 5 } } },
        }),
      );
      await boosted.engine.fields.grant(
        fieldDef({
          id: "forbid_talk",
          level: "L2",
          priority: 5,
          effects: { intent_forbid: ["talk"] },
        }),
      );
      await boosted.engine.fields.grant(
        fieldDef({
          id: "prob_low",
          level: "L0",
          priority: 2,
          effects: { event_prob: { care: 0.05 } },
        }),
      );
      await boosted.engine.fields.grant(
        fieldDef({
          id: "prob_shift",
          level: "L0",
          priority: 1,
          stacking: "max",
          holder: { kind: "location", ref: "tavern" },
          effects: { event_prob: { care: 0.18 } },
        }),
      );
      await boosted.engine.fields.grant(
        fieldDef({
          id: "l3_pack",
          level: "L3",
          effects: {
            rule_add: [{ id: "l3_extra", fn: "l3_mark", stage: "adjudicate", when: "true" }],
          },
        }),
      );
      await boosted.engine.fields.grant(
        fieldDef({
          id: "l4_belief",
          level: "L4",
          effects: {
            inject_belief: [{ text: "The cellar door feels unlocked.", tags: ["hint"], claims: [] }],
          },
        }),
      );
      await boosted.engine.fields.grant(
        fieldDef({
          id: "stack_add",
          level: "L1",
          priority: 1,
          stacking: "add",
          effects: { track_offset: { affinity: 2 } },
        }),
      );
      await boosted.engine.fields.grant(
        fieldDef({
          id: "stack_override",
          level: "L1",
          priority: 3,
          stacking: "override",
          effects: { track_offset: { affinity: 7 } },
        }),
      );
      const granted = await boosted.engine.timeline.events({ kinds: ["field.granted"] });
      expect(granted.length).toBeGreaterThanOrEqual(6);

      renderBodies.length = 0;
      await playFieldsTurn(boosted.engine, sceneFx, "fielded care");
      const fxCheck = (await boosted.engine.timeline.events({ kinds: ["check.rolled"] })).at(-1) as
        | { total?: number; modifier?: number }
        | undefined;
      expect(fxCheck?.total).toBe((baseCheck!.total ?? 0) + 5);
      const fxIntent = (await boosted.engine.timeline.events({ kinds: ["intent.decided"] })).at(-1) as
        | { intent?: string }
        | undefined;
      expect(fxIntent?.intent).toBe("listen");
      expect(renderBodies.some((b) => b.includes("Event probability shifts: care:0.18"))).toBe(true);
      const probMark = (await boosted.engine.timeline.events({ kinds: ["track.delta"] })).find(
        (e) => (e as { reason?: string }).reason === "event_prob_cel",
      );
      expect(probMark).toBeDefined();
      const l3Mark = (await boosted.engine.timeline.events({ kinds: ["track.delta"] })).find(
        (e) => (e as { reason?: string }).reason === "l3_field_rule",
      );
      expect(l3Mark).toBeDefined();
      expect(renderBodies.some((b) => b.includes("cellar door"))).toBe(true);

      await boosted.engine.fields.grant(
        fieldDef({
          id: "short_ttl",
          level: "L0",
          scope: { turns: 1, when: "true" },
          effects: { event_prob: { chat: 0.5 } },
        }),
      );
      renderBodies.length = 0;
      await playFieldsTurn(boosted.engine, sceneFx, "ttl turn one");
      expect(renderBodies.some((b) => b.includes("chat:0.5"))).toBe(true);
      renderBodies.length = 0;
      await playFieldsTurn(boosted.engine, sceneFx, "ttl turn two");
      expect(renderBodies.every((b) => !b.includes("chat:0.5"))).toBe(true);

      await boosted.engine.fields.revoke("check_boost");
      await boosted.engine.fields.revoke("forbid_talk");
      expect((await boosted.engine.timeline.events({ kinds: ["field.revoked"] })).length).toBeGreaterThanOrEqual(2);

      renderBodies.length = 0;
      await playFieldsTurn(boosted.engine, sceneFx, "after revoke");
      const afterIntent = (await boosted.engine.timeline.events({ kinds: ["intent.decided"] })).at(-1) as
        | { intent?: string }
        | undefined;
      expect(afterIntent?.intent).toBe("talk");
      const afterCheck = (await boosted.engine.timeline.events({ kinds: ["check.rolled"] })).at(-1) as
        | { modifier?: number }
        | undefined;
      expect((afterCheck?.modifier ?? 0)).toBeLessThan((fxCheck?.modifier ?? 0));
      expect((fxCheck?.modifier ?? 0)).toBeGreaterThanOrEqual((baseCheck?.modifier ?? 0) + 5);

      await baseline.engine.scene.end(sceneBase);
      await boosted.engine.scene.end(sceneFx);
      await baseline.audit({ snapshots: false });
      await boosted.audit({ snapshots: false });

      const twinA = await openFieldsEngine({
        preset: fieldsPreset(),
        models: { s1: careScriptedLlm().s1, s2: careScriptedLlm().s2 },
        mode: "full",
        sessionId: "fields_det_a",
      });
      const twinB = await openFieldsEngine({
        preset: fieldsPreset(),
        models: { s1: careScriptedLlm().s1, s2: careScriptedLlm().s2 },
        mode: "full",
        sessionId: "fields_det_b",
      });
      try {
        const sA = await twinA.engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
        const sB = await twinB.engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
        await playFieldsTurn(twinA.engine, sA, "determinism probe");
        await playFieldsTurn(twinB.engine, sB, "determinism probe");
        const stripSid = (log: string) => log.replace(/"sid":"[^"]+"/g, '"sid":"fixed"');
        expect(stripSid(stableStringify(await twinA.engine.timeline.events()))).toBe(
          stripSid(stableStringify(await twinB.engine.timeline.events())),
        );
        await twinA.audit({ snapshots: false });
      } finally {
        await twinA.dispose();
        await twinB.dispose();
      }
    } finally {
      await baseline.dispose();
      await boosted.dispose();
    }
  });

  test("record then replay preserves field-effect turn log (I6)", async () => {
    const llm = careScriptedLlm();
    const h = await openFieldsEngine({
      preset: fieldsPreset(),
      models: { s1: llm.s1, s2: llm.s2 },
      mode: "full",
      modelMode: "record",
      sessionId: "fields_i6",
    });
    try {
      const sceneId = await h.engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      await h.engine.fields.grant(
        fieldDef({ id: "replay_prob", level: "L0", effects: { event_prob: { care: 0.11 } } }),
      );
      await playFieldsTurn(h.engine, sceneId, "replay care");
      const liveLog = stableStringify(await h.engine.timeline.events());
      await h.engine.close();

      const replayEngine = await h.reopen({ modelMode: "replay", sessionId: "fields_i6_b" });
      const replayLog = stableStringify(await replayEngine.timeline.events());
      expect(replayLog).toBe(liveLog);
      await replayEngine.close();
      await h.audit({ snapshots: false });
    } finally {
      await h.dispose();
    }
  });
});
