import { describe, expect, test } from "bun:test";
import { drainTurn, openWorldEngine, worldPreset, worldScriptedModels } from "./world-fixture.ts";
import { expectKindsInOrder } from "./world-invariants.ts";

describe("world director e2e", () => {
  test("soft field before deadline and hard fallback after (WorldTime deadline)", async () => {
    const h = await openWorldEngine({
      seed: async (s) => {
        await s.writeAtomic(
          "world/fields/soft-pressure.yaml",
          `id: soft-pressure
holder:
  kind: world
source: author
level: L0
priority: 0
stacking: add
scope:
  when: "true"
effects:
  world_vars:
    pressure: 1
`,
        );
        await s.writeAtomic(
          "world/anchors.yaml",
          `- id: rescue
  soft:
    id: soft-pressure
    holder:
      kind: world
    source: anchor
    level: L0
    priority: 0
    stacking: add
    scope:
      when: "true"
    effects:
      world_vars:
        pressure: 1
  target:
    kind: world_event
    spec:
      event: quest.done
  deadline:
    day: 1
    minute: 600
  strategies: [soft, hard]
  hard:
    - kind: world.var_set
      path: story.failed
      value: true
  refs: []
`,
        );
      },
    });
    try {
      await h.engine.world.advance({ to: { day: 1, minute: 596 } });
      await h.engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      const progress = await h.engine.timeline.events({ kinds: ["anchor.progress"] });
      expect(progress.some((e) => (e as { stage?: string }).stage === "soft")).toBe(true);
      await h.engine.world.advance({ to: { day: 1, minute: 720 } });
      expect(h.engine.query("debug", "world/vars/story.failed")).toBe(true);
      expect((await h.engine.timeline.events({ kinds: ["anchor.fallback"] })).length).toBe(1);
    } finally {
      await h.dispose();
    }
  });

  test("hard fallback entity.generate creates entity via scripted S1", async () => {
    const h = await openWorldEngine({
      seed: async (s) => {
        await s.writeAtomic(
          "world/anchors.yaml",
          `- id: spawn-deadline
  target:
    kind: world_event
    spec:
      event: impossible.e2e
  deadline:
    day: 1
    minute: 540
  strategies: [hard]
  hard:
    - kind: entity.generate
      request:
        kind: character
        template: extra
  refs: []
`,
        );
        await s.writeAtomic(
          "templates/character/extra.yaml",
          `fields:
  name:
    type: string
  summary:
    type: string
    optional: true
  persona:
    type: string
guidance: e2e
defaults:
  tags: []
lod: extra
`,
        );
      },
    });
    try {
      await h.engine.world.advance({ to: { day: 1, minute: 600 } });
      const req = (await h.engine.timeline.events({ kinds: ["entity.generate"] }))[0];
      const created = (await h.engine.timeline.events({ kinds: ["entity.created"] }))[0] as
        | { because?: string[]; entity?: { id: string } }
        | undefined;
      expect(req).toBeDefined();
      expect(created).toBeDefined();
      expect(created!.because).toContain(req!.id);
      expect(await h.storage.exists(`timelines/main/entities/character/${created!.entity!.id}.json`)).toBe(true);
    } finally {
      await h.dispose();
    }
  });

  test("force strategy requires L2 grant from policy", async () => {
    const h = await openWorldEngine({
      preset: worldPreset({
        fields: {
          grants: [{ holder: "true", source: "true", maxLevel: "L1" }],
          caps: {},
        },
      }),
      seed: async (s) => {
        await s.writeAtomic(
          "world/anchors.yaml",
          `- id: force-me
  force:
    id: force-push
    holder:
      kind: character
      ref: npc1
    source: anchor
    level: L2
    priority: 0
    stacking: add
    scope:
      when: "true"
    effects:
      intent_force: talk
  target:
    kind: character_choice
    spec:
      character: player
      choice: never
  deadline: "time.minute >= 540"
  strategies: [force]
  hard: []
  refs: []
`,
        );
      },
    });
    try {
      const sceneId = await h.engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      await drainTurn(h.engine.scene.turn({ sceneId, actor: "player", text: "tick", addressee: "npc1" }));
      const forceProgress = (await h.engine.timeline.events({ kinds: ["anchor.progress"] })).filter(
        (e) => (e as { stage?: string }).stage === "force",
      );
      expect(forceProgress.length).toBe(0);
    } finally {
      await h.dispose();
    }
  });

  test("beats enter and exit ordering", async () => {
    const h = await openWorldEngine({
      seed: async (s) => {
        await s.writeAtomic(
          "world/beats.yaml",
          `- id: act-one
  enter: "time.day == 1"
  exit: "time.day >= 2"
  fields: []
  note: Act one
- id: act-two
  enter: "time.day >= 2"
  exit: "false"
  fields: []
  note: Act two
`,
        );
      },
    });
    try {
      await h.engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      expect((await h.engine.timeline.events({ kinds: ["beat.entered"] })).some((e) => (e as { beat?: string }).beat === "act-one")).toBe(
        true,
      );
      await h.engine.world.advance({ to: { day: 2, minute: 0 } });
      const all = await h.engine.timeline.events();
      expect(all.some((e) => e.kind === "beat.exited" && (e as { beat?: string }).beat === "act-one")).toBe(true);
      expect(all.some((e) => e.kind === "beat.entered" && (e as { beat?: string }).beat === "act-two")).toBe(true);
    } finally {
      await h.dispose();
    }
  });

  test("sidenote ttl, verbatim false echo detection", async () => {
    const h = await openWorldEngine({
      models: worldScriptedModels({ renderText: "The hint 1234567890 appears in speech." }),
    });
    try {
      const sceneId = await h.engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      await h.engine.director.sidenote("npc1", "1234567890", { verbatim: false, ttlTurns: 1 });
      await drainTurn(h.engine.scene.turn({ sceneId, actor: "player", text: "talk", addressee: "npc1" }));
      expect((await h.engine.timeline.events({ kinds: ["sidenote.added"] })).length).toBe(1);
      expect((await h.engine.timeline.events({ kinds: ["sidenote.echoed"] })).length).toBe(1);
    } finally {
      await h.dispose();
    }
  });

  test("exception channel charges, period, mayBypass, exception.used", async () => {
    const h = await openWorldEngine({
      seed: async (s) => {
        await s.writeAtomic(
          "world/exceptions.yaml",
          `- id: ex
  charges: 1
  period: session
  mayBypass: [field_cap, track_cap]
`,
        );
      },
    });
    try {
      const entry = await h.engine.director.invokeException("ex", "field_cap");
      expect(entry.kind).toBe("exception.used");
      await expect(h.engine.director.invokeException("ex", "track_cap")).rejects.toThrow(/charges/);
    } finally {
      await h.dispose();
    }
  });
});
