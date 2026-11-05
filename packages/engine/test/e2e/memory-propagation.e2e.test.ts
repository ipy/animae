import { describe, expect, test } from "bun:test";
import { drainTurn, openWorldEngine } from "./world-fixture.ts";
import { artifactPath } from "../../src/timeline/paths.ts";
import { memoryPropagationPreset, seedShareableNpc1Memory } from "./memory-fixture.ts";

describe("memory propagation gating e2e (spec 9, policy onTick)", () => {
  test("onTick day: propagates on world.advance midnight, not at scene.end", async () => {
    const h = await openWorldEngine({
      preset: memoryPropagationPreset("day"),
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
        await seedShareableNpc1Memory(s, "mem_prop_day", "Gossip for the player at day tick.");
      },
    });
    try {
      const sceneId = await h.engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      await drainTurn(h.engine.scene.turn({ sceneId, actor: "player", text: "Hi", addressee: "npc1" }));
      await h.engine.world.advance({ to: { day: 2, minute: 480 } });
      const afterAdvance = await h.engine.timeline.events({ kinds: ["memory.propagated"] });
      expect(afterAdvance.length).toBeGreaterThan(0);
      expect((afterAdvance[0] as { from?: string; to?: string }).from).toBe("npc1");

      await h.engine.scene.end(sceneId);
      const afterEnd = await h.engine.timeline.events({ kinds: ["memory.propagated"] });
      expect(afterEnd.length).toBe(afterAdvance.length);
    } finally {
      await h.dispose();
    }
  });

  test("onTick scene_end: propagates at scene.end, not on day boundary", async () => {
    const h = await openWorldEngine({
      preset: memoryPropagationPreset("scene_end"),
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
        await seedShareableNpc1Memory(s, "mem_prop_scene", "Gossip at scene end only.");
      },
    });
    try {
      const sceneId = await h.engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      await drainTurn(h.engine.scene.turn({ sceneId, actor: "player", text: "Hello", addressee: "npc1" }));
      await h.engine.world.advance({ to: { day: 2, minute: 0 } });
      expect((await h.engine.timeline.events({ kinds: ["memory.propagated"] })).length).toBe(0);
      await h.engine.scene.end(sceneId);
      const propagated = await h.engine.timeline.events({ kinds: ["memory.propagated"] });
      expect(propagated.length).toBeGreaterThan(0);
      const written = await h.engine.timeline.events({ kinds: ["memory.written"] });
      for (const p of propagated) {
        const link = p as { memoryId?: string; newMemoryId?: string };
        expect(link.memoryId).toBe("mem_prop_scene");
        expect(written.some((w) => (w as { memoryId?: string }).memoryId === link.newMemoryId)).toBe(true);
      }
    } finally {
      await h.dispose();
    }
  });

  test("no relation path with share: target is not reached", async () => {
    const h = await openWorldEngine({
      preset: memoryPropagationPreset("scene_end"),
      seed: async (s) => {
        await s.writeAtomic(
          "characters/npc3/card.md",
          `---
identity:
  id: npc3
  name: Cara
tags: []
constraints:
  motives: []
  bottom_lines: []
  taboos: []
lod: principal
---
Persona for Cara.
`,
        );
        await s.writeAtomic("characters/npc3/relations.yaml", "[]\n");
        await s.writeAtomic(
          "characters/npc1/relations.yaml",
          `- to: player
  kind: friend
  tracks:
    affinity: 55
  share: "true"
- to: npc3
  kind: acquaintance
  tracks:
    affinity: 40
  share: "false"
`,
        );
        await seedShareableNpc1Memory(s, "mem_no_path", "Should not reach npc3.");
      },
    });
    try {
      const sceneId = await h.engine.scene.start({ location: "tavern", participants: ["player", "npc1", "npc3"] });
      await drainTurn(h.engine.scene.turn({ sceneId, actor: "player", text: "Hi", addressee: "npc1" }));
      await h.engine.scene.end(sceneId);
      const propagated = await h.engine.timeline.events({ kinds: ["memory.propagated"] });
      expect(propagated.some((e) => (e as { to?: string }).to === "player")).toBe(true);
      expect(propagated.some((e) => (e as { to?: string }).to === "npc3")).toBe(false);
      const npc3Mem = await h.storage.readText(artifactPath("main", "npc3/memory.jsonl"));
      expect(npc3Mem ?? "").not.toContain("mem_no_path");
    } finally {
      await h.dispose();
    }
  });
});
