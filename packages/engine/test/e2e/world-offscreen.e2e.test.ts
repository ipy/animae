import { describe, expect, test } from "bun:test";
import { artifactPath } from "../../src/timeline/paths.ts";
import { drainTurn, openWorldEngine, worldPreset, worldScriptedModels } from "./world-fixture.ts";
import { decayDeltaEvents } from "./world-invariants.ts";

describe("world offscreen e2e", () => {
  test("scene start catch-up writes offscreen.simulated (rule fidelity)", async () => {
    const h = await openWorldEngine({
      preset: worldPreset({
        offscreen: { fidelity: { default: "rule", locations: {}, characters: {} } },
      }),
    });
    try {
      await h.engine.world.advance({ to: { day: 1, minute: 540 } });
      await h.engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      expect((await h.engine.timeline.events({ kinds: ["offscreen.simulated"] })).length).toBeGreaterThan(0);
    } finally {
      await h.dispose();
    }
  });

  test("queryAsync catches up; sync query does not", async () => {
    const h = await openWorldEngine({
      preset: worldPreset({
        offscreen: { fidelity: { default: "rule", locations: { tavern: "rule" }, characters: {} } },
      }),
    });
    try {
      await h.engine.world.advance({ to: { day: 1, minute: 510 } });
      const before = (await h.engine.timeline.events({ kinds: ["offscreen.simulated"] })).length;
      h.engine.query("player", "world/locations/tavern");
      const afterSync = (await h.engine.timeline.events({ kinds: ["offscreen.simulated"] })).length;
      expect(afterSync).toBe(before);
      await h.engine.queryAsync("player", "world/locations/tavern");
      expect((await h.engine.timeline.events({ kinds: ["offscreen.simulated"] })).length).toBeGreaterThan(before);
    } finally {
      await h.dispose();
    }
  });

  test("narrate fidelity uses S2 sentence and persists artifact", async () => {
    const h = await openWorldEngine({
      preset: worldPreset({
        offscreen: { fidelity: { default: "narrate", locations: {}, characters: {} } },
      }),
      models: worldScriptedModels(),
    });
    try {
      await h.engine.world.advance({ to: { day: 1, minute: 500 } });
      await h.engine.queryAsync("player", "world/locations/tavern");
      expect(await h.storage.exists(artifactPath("main", "artifacts/_offscreen/tavern.jsonl"))).toBe(true);
    } finally {
      await h.dispose();
    }
  });

  test("rule backend narrate template when S2 on rule backend", async () => {
    const h = await openWorldEngine({
      preset: worldPreset({
        offscreen: {
          fidelity: { default: "narrate", locations: {}, characters: {} },
          narrateTemplate: "{{ location.name }} is quiet at minute {{ time.minute }}.",
        },
      }),
      mode: "rule",
    });
    try {
      await h.engine.world.advance({ to: { day: 1, minute: 495 } });
      await h.engine.queryAsync("player", "world/locations/tavern");
      const raw = (await h.storage.readText(artifactPath("main", "artifacts/_offscreen/tavern.jsonl"))) ?? "";
      expect(raw.includes("Tavern")).toBe(true);
    } finally {
      await h.dispose();
    }
  });

  test("offscreen NPC movement and world var changes without double decay", async () => {
    const h = await openWorldEngine({
      preset: worldPreset({
        offscreen: { fidelity: { default: "full", locations: {}, characters: { npc2: "rule" } } },
        tracks: {
          mood: {
            scope: "self",
            min: -100,
            max: 100,
            initial: 50,
            tiers: [],
            hysteresis: 0,
            decay: { toward: 0, ratePerHour: 0.05 },
          },
        },
      }),
      seed: async (s) => {
        await s.writeAtomic(
          "world/schedule.yaml",
          `- id: npc2-move
  at: "day 1 09:00"
  when: "true"
  emit:
    kind: world.moved
    who: npc2
    location: tavern
- id: var-bump
  at: "day 1 09:30"
  emit:
    kind: world.var_set
    path: offscreen.flag
    value: 1
`,
        );
      },
    });
    try {
      await h.engine.world.advance({ to: { day: 1, minute: 600 } });
      const decayAfterAdvance = decayDeltaEvents(await h.engine.timeline.events()).length;
      await h.engine.queryAsync("player", "characters/npc2/identity");
      expect(h.engine.query("debug", "world/vars/offscreen.flag")).toBe(1);
      expect(decayDeltaEvents(await h.engine.timeline.events()).length).toBe(decayAfterAdvance);
    } finally {
      await h.dispose();
    }
  });
});
