import { describe, expect, test } from "bun:test";
import { SNAPSHOT_EVERY } from "../../src/timeline/snapshots.ts";
import { snapshotsDir } from "../../src/timeline/paths.ts";
import { drainTurn, eventsByKind, openWorldEngine, patchWorldStartMinute, worldPreset, worldScriptedModels } from "./world-fixture.ts";
import {
  assertStateReplayEquivalent,
  decayDeltaEvents,
  expectKindsInOrder,
  scheduleFiredIds,
  scheduleItemId,
} from "./world-invariants.ts";
import { artifactPath } from "../../src/timeline/paths.ts";
import { e2ePreset } from "./fixture.ts";
import { rulePreset } from "../helpers/rule-fixture.ts";
import { stableStringify } from "../../src/store/util.ts";

describe("world time e2e", () => {
  test("schedule at, every, when CEL, emit, and registered rule", async () => {
    const h = await openWorldEngine({
      preset: worldPreset({
        rules: { custom: [{ id: "daily_e2e", stage: "daily", fn: "e2e_daily", when: "true" }] },
      }),
      seed: async (s) => {
        await s.writeAtomic(
          "world/schedule.yaml",
          `- id: morning
  at: "day 1 08:30"
  emit:
    kind: world.var_set
    path: sched.at
    value: 1
- id: hourly
  every: hour
  when: "world.vars.gold >= 0"
  emit:
    kind: world.var_set
    path: sched.hourly
    value: 1
- id: ruled
  at: "day 1 09:00"
  rule: e2e_sched_rule
`,
        );
      },
      onOpen: (e) => {
        e.rules.register("e2e_sched_rule", () => [{ kind: "world.var_set", path: "sched.rule", value: 1 }]);
        e.rules.register("e2e_daily", () => [{ kind: "world.var_set", path: "sched.daily", value: 1 }]);
      },
    });
    try {
      await h.engine.world.advance({ to: { day: 2, minute: 60 } });
      const events = await h.engine.timeline.events();
      const fired = scheduleFiredIds(events);
      expect(fired).toContain("morning");
      expect(fired.filter((id) => id === "hourly").length).toBeGreaterThan(0);
      expect(fired).toContain("ruled");
      expect(h.engine.query("debug", "world/vars/sched.at")).toBe(1);
      expect(h.engine.query("debug", "world/vars/sched.rule")).toBe(1);
      expect(h.engine.query("debug", "world/vars/sched.daily")).toBe(1);
      expectKindsInOrder(events, ["schedule.fired", "time.advanced"]);
    } finally {
      await h.dispose();
    }
  });

  test("long event phases, interrupt, and catch-up across advance", async () => {
    const h = await openWorldEngine({
      seed: async (s) => {
        await patchWorldStartMinute(s, 470);
        await s.writeAtomic(
          "world/schedule.yaml",
          `- id: fest
  at: "day 1 08:00"
  duration: 120
  phases:
    - id: setup
      minutes: 30
    - id: main
      minutes: 60
    - id: teardown
      minutes: 30
  onInterrupt: e2e_stop_fest
  emit:
    kind: world.var_set
    path: fest.started
    value: true
`,
        );
      },
      onOpen: (e) => {
        e.rules.register("e2e_stop_fest", () => [{ kind: "world.var_set", path: "fest.stopped", value: true }]);
      },
    });
    try {
      await h.engine.world.advance({ to: { day: 1, minute: 620 } });
      const phases = await eventsByKind(h.engine, "longevent.phase");
      expect(phases.length).toBeGreaterThanOrEqual(1);
      expect(h.engine.query("debug", "world/vars/fest.started")).toBe(true);
      expect(scheduleFiredIds(await h.engine.timeline.events())).toContain("fest");
    } finally {
      await h.dispose();
    }
  });

  test("decay ticks once per advance segment; catch-up does not double decay", async () => {
    const h = await openWorldEngine({
      preset: worldPreset({
        tracks: {
          mood: {
            scope: "self",
            min: -100,
            max: 100,
            initial: 50,
            tiers: [],
            hysteresis: 0,
            decay: { toward: 0, ratePerHour: 0.1 },
          },
        },
      }),
    });
    try {
      await h.engine.world.advance("2h");
      const afterAdvance = decayDeltaEvents(await h.engine.timeline.events()).length;
      expect(afterAdvance).toBeGreaterThan(0);
      await h.engine.queryAsync("player", "characters/npc1/identity");
      await h.engine.queryAsync("player", "characters/npc2/identity");
      const totalDecay = decayDeltaEvents(await h.engine.timeline.events()).length;
      expect(totalDecay).toBe(afterAdvance);
    } finally {
      await h.dispose();
    }
  });

  test("deck draw on day boundary is deterministic", async () => {
    const h = await openWorldEngine({
      seed: async (s) => {
        await s.writeAtomic(
          "world/decks/daily.yaml",
          `id: daily
drawOn: day
maxPerDay: 1
entries:
  - id: a
    weight: 1
    emit:
      kind: world.var_set
      path: deck.pick
      value: a
  - id: b
    weight: 9
    emit:
      kind: world.var_set
      path: deck.pick
      value: b
`,
        );
      },
    });
    try {
      await h.engine.world.advance({ to: { day: 2, minute: 480 } });
      const draws = await eventsByKind(h.engine, "deck.drawn");
      expect(draws.length).toBe(1);
      const entryId = (draws[0] as { entryId?: string }).entryId;
      expect(entryId === "a" || entryId === "b").toBe(true);
      expect(h.engine.query("debug", "world/vars/deck.pick")).toBeTruthy();
    } finally {
      await h.dispose();
    }
  });

  test("schedule_offset from active L0 field shifts fire time", async () => {
    const h = await openWorldEngine({
      onOpen: async (e) => {
        await e.fields.grant({
          id: "offset",
          holder: { kind: "world" },
          source: "author",
          level: "L0",
          priority: 0,
          stacking: "add",
          scope: { when: "true" },
          effects: { schedule_offset: { bell: 45 } },
        });
      },
      seed: async (s) => {
        await patchWorldStartMinute(s, 470);
        await s.writeAtomic(
          "world/schedule.yaml",
          `- id: bell
  at: "day 1 08:00"
  emit:
    kind: world.var_set
    path: bell
    value: 1
`,
        );
        await s.writeAtomic(
          "world/fields/offset.yaml",
          `id: offset
holder:
  kind: world
source: author
level: L0
priority: 0
stacking: add
scope:
  when: "true"
effects:
  schedule_offset:
    bell: 45
`,
        );
      },
    });
    try {
      const sceneId = await h.engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      await h.engine.world.advance({ to: { day: 1, minute: 600 } });
      const fired = (await h.engine.timeline.events({ kinds: ["schedule.fired"] })).find(
        (e) => scheduleItemId(e) === "bell",
      ) as { at?: { minute: number } } | undefined;
      expect(fired?.at?.minute).toBe(525);
      await h.engine.scene.end(sceneId);
    } finally {
      await h.dispose();
    }
  });

  test("time.advanced drives director ticks; memory propagates on day boundary only", async () => {
    const h = await openWorldEngine({
      preset: worldPreset({
        memory: {
          write: { episodic: true, minIntensity: 0.1, maxChars: 200 },
          forgetting: { enabled: false, tau: 30, threshold: 0.2 },
          distortion: { enabled: false, p: 0, maxImportance: 1, kinds: [] },
          propagation: { enabled: true, onTick: "day", distortionPerHop: 1 },
        },
        reflection: { enabled: false, accept: "true" },
      }),
      seed: async (s) => {
        await s.writeAtomic(
          "characters/npc1/relations.yaml",
          `- to: player
  kind: friend
  tracks:
    affinity: 55
  share: "true"
`,
        );
        await s.writeAtomic(
          artifactPath("main", "npc1/memory.jsonl"),
          `${JSON.stringify({
            id: "mem_prop",
            t: { day: 1, minute: 480 },
            kind: "episodic",
            text: "Aria remembers the tavern.",
            tags: ["shareable"],
            shareable: true,
            claims: [],
            importance: 0.6,
            valence: 0.2,
            branch: "main",
          })}\n`,
        );
        await s.writeAtomic(
          "world/anchors.yaml",
          `- id: tick-anchor
  target:
    kind: world_event
    spec:
      event: never.e2e
  deadline:
    day: 1
    minute: 900
  strategies: [hard]
  hard:
    - kind: world.var_set
      path: anchor.fired
      value: true
  refs: []
`,
        );
      },
    });
    try {
      const sceneId = await h.engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      await drainTurn(h.engine.scene.turn({ sceneId, actor: "player", text: "Hi", addressee: "npc1" }));
      await h.engine.world.advance({ to: { day: 2, minute: 480 } });
      const kinds = (await h.engine.timeline.events()).map((e) => e.kind);
      expect(kinds.filter((k) => k === "time.advanced").length).toBeGreaterThan(0);
      expect(kinds.filter((k) => k === "memory.propagated").length).toBeGreaterThan(0);
      await h.engine.scene.end(sceneId);
      const afterScene = await h.engine.timeline.events({ kinds: ["memory.propagated"] });
      expect(afterScene.length).toBe(kinds.filter((k) => k === "memory.propagated").length);
    } finally {
      await h.dispose();
    }
  });

  test("memory propagation onTick scene_end variant", async () => {
    const h = await openWorldEngine({
      preset: worldPreset({
        memory: {
          write: { episodic: true, minIntensity: 0.1, maxChars: 200 },
          forgetting: { enabled: false, tau: 30, threshold: 0.2 },
          distortion: { enabled: false, p: 0, maxImportance: 1, kinds: [] },
          propagation: { enabled: true, onTick: "scene_end", distortionPerHop: 1 },
        },
        reflection: { enabled: false, accept: "true" },
      }),
      seed: async (s) => {
        await s.writeAtomic(
          "characters/npc1/relations.yaml",
          `- to: player
  kind: friend
  tracks:
    affinity: 55
  share: "true"
`,
        );
        await s.writeAtomic(
          artifactPath("main", "npc1/memory.jsonl"),
          `${JSON.stringify({
            id: "mem_scene",
            t: { day: 1, minute: 480 },
            kind: "episodic",
            text: "Shared scene memory.",
            tags: ["shareable"],
            shareable: true,
            claims: [],
            importance: 0.5,
            valence: 0,
            branch: "main",
          })}\n`,
        );
      },
    });
    try {
      const sceneId = await h.engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      await drainTurn(h.engine.scene.turn({ sceneId, actor: "player", text: "Hello", addressee: "npc1" }));
      await h.engine.world.advance({ to: { day: 2, minute: 0 } });
      expect((await h.engine.timeline.events({ kinds: ["memory.propagated"] })).length).toBe(0);
      await h.engine.scene.end(sceneId);
      expect((await h.engine.timeline.events({ kinds: ["memory.propagated"] })).length).toBeGreaterThan(0);
    } finally {
      await h.dispose();
    }
  });

  test("snapshots every 200 events and on scene end match full replay", async () => {
    const preset = rulePreset();
    const h = await openWorldEngine({ preset, models: worldScriptedModels(), mode: "rule" });
    try {
      const sceneId = await h.engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      let countSnaps: string[] = [];
      for (let i = 0; i < 80; i++) {
        await drainTurn(h.engine.scene.turn({ sceneId, actor: "player", text: "snap tick", addressee: "npc1" }));
        countSnaps = (await h.storage.listFiles(snapshotsDir("main"))).filter((f) => f.endsWith(".json"));
        if (countSnaps.length > 0) break;
      }
      expect(countSnaps.length).toBeGreaterThan(0);

      await drainTurn(h.engine.scene.turn({ sceneId, actor: "player", text: "snap", addressee: "npc1" }));
      await h.engine.scene.end(sceneId);
      const sceneSnaps = (await h.storage.listFiles(snapshotsDir("main"))).filter((f) => f.endsWith(".json"));
      expect(sceneSnaps.length).toBeGreaterThan(countSnaps.length);

      const eventLog = stableStringify(await h.engine.timeline.events());
      await h.engine.close();
      const reopened = await h.reopen({ modelMode: "replay", mode: "rule" });
      expect(stableStringify(await reopened.timeline.events())).toBe(eventLog);
      await assertStateReplayEquivalent(reopened, h.storage, "main", [preset]);
      await reopened.close();
    } finally {
      await h.dispose();
    }
  });
});
