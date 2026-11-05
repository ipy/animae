import { describe, expect, test } from "bun:test";
import { stableStringify } from "../../src/store/util.ts";
import { loadAuthored } from "../../src/authored/load.ts";
import { createPresetRegistry } from "../../src/policy/registry.ts";
import { loadPolicy } from "../../src/policy/load.ts";
import { rebuildState } from "../../src/timeline/snapshots.ts";
import { assertLogInvariants, assertSnapshotsMatchReplay, stateFingerprint } from "../e2e/session-invariants.ts";
import {
  SECRET_LOW_TEXT,
  SECRET_VAULT_TEXT,
  careScriptedLlm,
  openFieldsEngine,
  playFieldsTurn,
  promptBlob,
  secretTrustPreset,
  seedSecretTrustAuthored,
} from "../e2e/fields-fixture.ts";
import { forbiddenModels } from "../e2e/session-fixture.ts";

type UnlockEv = { secret?: string; source?: string; because?: string[] };

describe("secret unlock pipeline", () => {
  test("care turn unlocks trust_low after track.delta; prompt, query, explain, idempotency, I6, I2", async () => {
    let renderBody = "";
    const llm = careScriptedLlm({ captureRender: (req) => (renderBody = promptBlob(req)) });
    const h = await openFieldsEngine({
      preset: secretTrustPreset(),
      authoredSeed: seedSecretTrustAuthored,
      models: { s1: llm.s1, s2: llm.s2 },
      mode: "full",
      modelMode: "record",
      sessionId: "secret_unlock_i6",
    });
    try {
      const sceneId = await h.engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      await playFieldsTurn(h.engine, sceneId, "earn your trust");

      const events = await h.engine.timeline.events();
      assertLogInvariants(events);

      const appraisal = events.find((e) => e.kind === "appraisal" && e.turn);
      expect(appraisal?.id).toBeDefined();
      const turnId = appraisal!.turn!;
      const slice = events.filter((e) => e.turn === turnId);
      const trustDeltaIdx = slice.findIndex((e) => e.kind === "track.delta" && (e as { track?: string }).track === "trust");
      const unlockIdx = slice.findIndex((e) => e.kind === "character.secret_unlocked");
      expect(trustDeltaIdx).toBeGreaterThanOrEqual(0);
      expect(unlockIdx).toBeGreaterThan(trustDeltaIdx);
      const unlock = slice[unlockIdx] as UnlockEv;
      expect(unlock.secret).toBe("trust_low");
      expect(unlock.source).toBe("rules:secrets");
      expect(unlock.because).toContain(appraisal!.id);

      expect(renderBody).toContain(SECRET_LOW_TEXT);
      expect(renderBody).not.toContain(SECRET_VAULT_TEXT);

      const secrets = h.engine.query("debug", "characters/npc1/secrets") as { id: string }[];
      expect(secrets.map((s) => s.id)).toEqual(["trust_low"]);

      const playerEx = h.engine.explain(turnId, "player");
      expect(playerEx.chain.some((c) => c.kind === "character.secret_unlocked")).toBe(false);
      expect(h.engine.explain(turnId, "debug").chain.some((c) => c.kind === "character.secret_unlocked")).toBe(true);

      await playFieldsTurn(h.engine, sceneId, "still caring");
      expect((await h.engine.timeline.events({ kinds: ["character.secret_unlocked"] })).length).toBe(1);

      await h.engine.scene.end(sceneId);

      const registry = createPresetRegistry([secretTrustPreset()]);
      const authored = await loadAuthored(h.storage, { presets: registry, liftDisplayStrings: true });
      const { policy } = await loadPolicy(h.storage, authored.config, registry);
      const eventsAfterEnd = await h.engine.timeline.events();
      expect(stateFingerprint(await rebuildState(authored, policy, eventsAfterEnd))).toBe(
        stateFingerprint(h.engine.query("debug", "state")),
      );

      await assertSnapshotsMatchReplay({
        storage: h.storage,
        branch: "main",
        presets: [secretTrustPreset()],
        events: eventsAfterEnd,
      });

      const liveLog = stableStringify(eventsAfterEnd);
      await h.audit({ snapshots: false });
      await h.engine.close();
      const replayEngine = await h.reopen({ modelMode: "replay", sessionId: "secret_unlock_i6_b", mode: "full" });
      expect(stableStringify(await replayEngine.timeline.events())).toBe(liveLog);
      await replayEngine.close();
    } finally {
      await h.dispose();
    }
  });

  test("same turn: unlock runs before route.decided so unlocked tag does not trigger secret_topic", async () => {
    const llm = careScriptedLlm({ tags: ["heirloom"] });
    const h = await openFieldsEngine({
      preset: secretTrustPreset(),
      authoredSeed: seedSecretTrustAuthored,
      models: { s1: llm.s1, s2: llm.s2 },
      mode: "full",
    });
    try {
      const sceneId = await h.engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      await playFieldsTurn(h.engine, sceneId, "care with heirloom tag");
      const route = (await h.engine.timeline.events({ kinds: ["route.decided"] })).slice(-1)[0] as {
        triggers?: string[];
      };
      expect((await h.engine.timeline.events({ kinds: ["character.secret_unlocked"] })).length).toBe(1);
      expect(route?.triggers ?? []).not.toContain("secret_topic");
      await h.engine.scene.end(sceneId);
      await h.audit({ snapshots: false });
    } finally {
      await h.dispose();
    }
  });

  test("rule backend only: unlock event and query still work without models", async () => {
    const { models } = forbiddenModels();
    const h = await openFieldsEngine({
      preset: secretTrustPreset(),
      authoredSeed: seedSecretTrustAuthored,
      models,
      mode: "rule",
    });
    try {
      const sceneId = await h.engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      await playFieldsTurn(h.engine, sceneId, "/care 1 earn trust");
      const events = await h.engine.timeline.events();
      expect(events.some((e) => e.kind === "character.secret_unlocked")).toBe(true);
      const secrets = h.engine.query("debug", "characters/npc1/secrets") as { id: string }[];
      expect(secrets.some((s) => s.id === "trust_low")).toBe(true);
      await h.engine.scene.end(sceneId);
      await h.audit({ snapshots: false });
    } finally {
      await h.dispose();
    }
  });
});
