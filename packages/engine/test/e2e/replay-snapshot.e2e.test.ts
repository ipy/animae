import { describe, expect, test } from "bun:test";
import { reduce } from "../../src/timeline/reducer.ts";
import { initialState } from "../../src/timeline/initial-state.ts";
import { rebuildState } from "../../src/timeline/snapshots.ts";
import { minimalAuthored, minimalPolicy } from "../timeline/fixture.ts";
import type { EngineEvent } from "../../src/types.ts";
import { forbiddenModels, playTurn } from "./session-fixture.ts";
import {
  openReplayRichEngine,
  pinSnapshotReplayWorld,
  replayRichPreset,
  runReplayTimelineBranchOps,
  runRichReplaySession,
} from "./replay-fixture.ts";
import { scheduleItemId } from "./world-invariants.ts";

describe("replay snapshot I2", () => {
  test("rich session: live state matches full replay and every snapshot", async () => {
    const h = await openReplayRichEngine();
    try {
      await runRichReplaySession(h);
      await pinSnapshotReplayWorld(h, replayRichPreset());
    } finally {
      await h.dispose();
    }
  });

  test("branch rewind and hot reload: live state matches full replay", async () => {
    const h = await openReplayRichEngine();
    try {
      await runRichReplaySession(h);
      await runReplayTimelineBranchOps(h);
      await pinSnapshotReplayWorld(h, replayRichPreset());
    } finally {
      await h.dispose();
    }
  });

  test("reopen from disk uses snapshot tail without calling models", async () => {
    const h = await openReplayRichEngine();
    try {
      await runRichReplaySession(h);
      await h.engine.close();
      const { calls, models } = forbiddenModels();
      const reopened = await h.reopen({ models, modelMode: "replay", mode: "rule" });
      expect(calls).toEqual([]);
      expect((await reopened.timeline.events()).length).toBeGreaterThan(0);
      await pinSnapshotReplayWorld({ ...h, engine: reopened }, replayRichPreset());
      await reopened.close();
    } finally {
      await h.dispose();
    }
  });

  test("legacy schedule.fired without schedule source uses non-evt envelope id", async () => {
    const authored = minimalAuthored();
    const policy = minimalPolicy();
    const legacy: EngineEvent[] = [
      {
        id: "morning_bell",
        kind: "schedule.fired",
        at: { day: 1, minute: 510 },
        t: { day: 1, minute: 510 },
        sid: "legacy",
        source: "world",
        because: [],
      } as EngineEvent,
    ];
    const modern: EngineEvent[] = [
      {
        id: "evt_0001",
        kind: "schedule.fired",
        at: { day: 1, minute: 510 },
        t: { day: 1, minute: 510 },
        sid: "s",
        source: "schedule:morning_bell",
        because: [],
      } as EngineEvent,
    ];
    let sLegacy = initialState(authored, policy);
    sLegacy = reduce(sLegacy, legacy[0]!, policy);
    expect(sLegacy.schedule.morning_bell?.done).toBe(true);

    let sModern = initialState(authored, policy);
    sModern = reduce(sModern, modern[0]!, policy);
    expect(sModern.schedule.morning_bell?.done).toBe(true);

    const fromRebuild = await rebuildState(authored, policy, modern);
    expect(fromRebuild.schedule.morning_bell?.done).toBe(true);
  });

  test("evt envelope without schedule source does not guess schedule item id", async () => {
    const authored = minimalAuthored();
    const policy = minimalPolicy();
    const broken: EngineEvent = {
      id: "evt_0099",
      kind: "schedule.fired",
      at: { day: 1, minute: 510 },
      t: { day: 1, minute: 510 },
      sid: "s",
      source: "engine",
      because: [],
    } as EngineEvent;
    let s = initialState(authored, policy);
    s = reduce(s, broken, policy);
    expect(s.schedule.evt_0099).toBeUndefined();
  });

  test("live schedule events carry schedule source for reducer", async () => {
    const h = await openReplayRichEngine();
    try {
      await h.engine.world.advance({ to: { day: 1, minute: 520 } });
      const fired = await h.engine.timeline.events({ kinds: ["schedule.fired"] });
      expect(fired.length).toBeGreaterThan(0);
      for (const e of fired) {
        expect(scheduleItemId(e)).toBe("dawn_tick");
      }
      await pinSnapshotReplayWorld(h, replayRichPreset());
    } finally {
      await h.dispose();
    }
  });

  test("purge after rich session: live state matches full replay", async () => {
    const h = await openReplayRichEngine();
    try {
      await runRichReplaySession(h);
      const sceneId = await h.engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      await playTurn(h.engine, sceneId, "line before purge");
      await h.engine.purge({ characters: ["npc1"] });
      expect((await h.engine.timeline.events({ kinds: ["purge.applied"] })).length).toBe(1);
      await h.engine.scene.end(sceneId);
      await pinSnapshotReplayWorld(h, replayRichPreset());
    } finally {
      await h.dispose();
    }
  });
});
