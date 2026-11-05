import { describe, expect, test } from "bun:test";
import { loadAuthored } from "../../src/authored/load.ts";
import { createPresetRegistry } from "../../src/policy/registry.ts";
import { prepareModOverlay } from "../../src/mods/prepare.ts";
import { openWorldEngine } from "./world-fixture.ts";
import { e2ePreset } from "./fixture.ts";

describe("world mods e2e", () => {
  test("mod overlay overrides authored files under mods/<id>/", async () => {
    const h = await openWorldEngine({
      yamlExtra: "mods:\n  - overlay\n",
      seed: async (s) => {
        await s.writeAtomic(
          "mods/overlay/mod.yaml",
          `id: overlay
name: Overlay
version: 1.0.0
`,
        );
        await s.writeAtomic(
          "mods/overlay/world/locations/tavern.yaml",
          `id: tavern
name: Tavern from mod
summary: Modded.
tags: []
connects: []
vars: {}
`,
        );
      },
    });
    try {
      const loc = h.engine.query("debug", "world/locations/tavern") as { name?: string };
      expect(loc?.name).toBe("Tavern from mod");
      const listed = h.engine.mods();
      expect(listed.mods.map((m) => m.id)).toContain("overlay");
    } finally {
      await h.dispose();
    }
  });

  test("invalid mod manifest prevents engine startup", async () => {
    await expect(
      openWorldEngine({
        yamlExtra: "mods:\n  - broken\n",
        seed: async (s) => {
          await s.writeAtomic("mods/broken/mod.yaml", "id: broken\n");
        },
      }),
    ).rejects.toThrow();
  });

  test("hot reload applies overlay edit and logs config.reloaded", async () => {
    const h = await openWorldEngine({
      yamlExtra: "mods:\n  - overlay\n",
      seed: async (s) => {
        await s.writeAtomic(
          "mods/overlay/mod.yaml",
          `id: overlay
name: Overlay
version: 1.0.0
`,
        );
        await s.writeAtomic(
          "mods/overlay/world/world.yaml",
          `title: E2E
language: de
player: player
start_location: tavern
calendar:
  sceneMinutes: 5
  turnMinutes: 1
start:
  day: 1
  minute: 480
vars:
  gold: 5
`,
        );
      },
    });
    try {
      expect(h.engine.info().language).toBe("de");
      await h.storage.writeAtomic(
        "mods/overlay/world/world.yaml",
        (await h.storage.readText("mods/overlay/world/world.yaml"))!.replace("language: de", "language: fr"),
      );
      const r = await h.engine.reload();
      expect(r.ok).toBe(true);
      expect(h.engine.info().language).toBe("fr");
      expect((await h.engine.timeline.events({ kinds: ["config.reloaded"] })).length).toBeGreaterThan(0);
    } finally {
      await h.dispose();
    }
  });

  test("hot reload failure keeps config and logs config.error until the files are fixed", async () => {
    const h = await openWorldEngine({
      yamlExtra: "mods:\n  - overlay\n",
      seed: async (s) => {
        await s.writeAtomic(
          "mods/overlay/mod.yaml",
          `id: overlay
name: Overlay
version: 1.0.0
`,
        );
      },
    });
    try {
      const langBefore = h.engine.info().language;
      const goodYaml = (await h.storage.readText("animae.yaml"))!;
      const reloadedBefore = (await h.engine.timeline.events({ kinds: ["config.reloaded"] })).length;
      await h.storage.writeAtomic("animae.yaml", "not-valid-yaml: [");
      const r = await h.engine.reload();
      expect(r.ok).toBe(false);
      expect(h.engine.info().language).toBe(langBefore);
      expect(r.errors.length).toBeGreaterThan(0);

      // The failure is logged with its message, and no new configuration took effect.
      const errors = (await h.engine.timeline.events({ kinds: ["config.error"] })) as unknown as { message: string }[];
      expect(errors).toHaveLength(1);
      expect(errors[0]!.message).toBe(r.errors[0]!);
      expect(await h.engine.timeline.events({ kinds: ["config.reloaded"] })).toHaveLength(reloadedBefore);

      // Once the files are valid again the next reload goes through.
      await h.storage.writeAtomic("animae.yaml", `${goodYaml.replace(/\n?$/, "\n")}# touched\n`);
      const fixed = await h.engine.reload();
      expect(fixed.errors).toEqual([]);
      expect(await h.engine.timeline.events({ kinds: ["config.error"] })).toHaveLength(1);
    } finally {
      await h.dispose();
    }
  });

  test("merged authored hash differs from base when mod patches world", async () => {
    const h = await openWorldEngine({
      yamlExtra: "mods:\n  - overlay\n",
      seed: async (s) => {
        await s.writeAtomic(
          "mods/overlay/mod.yaml",
          `id: overlay
name: Overlay
version: 1.0.0
`,
        );
        await s.writeAtomic(
          "mods/overlay/world/locations/extra.yaml",
          `id: extra
name: Extra
summary: ""
tags: []
connects: []
vars: {}
`,
        );
      },
    });
    try {
      const { readStorage, ordered } = await prepareModOverlay(h.storage, ["overlay"], { selection: ["overlay"] });
      const registry = createPresetRegistry([e2ePreset]);
      const base = await loadAuthored(h.storage, { presets: registry });
      const merged = await loadAuthored(readStorage, { resolvedMods: ordered, presets: registry });
      expect(merged.locations.extra?.id).toBe("extra");
      expect(merged.hash).not.toBe(base.hash);
    } finally {
      await h.dispose();
    }
  });

  test("runtime rule registered after open runs on world advance", async () => {
    const h = await openWorldEngine({
      onOpen: (e) => {
        e.rules.register("mod_sched", () => [{ kind: "world.var_set", path: "mod.hook", value: 1 }]);
      },
      seed: async (s) => {
        await s.writeAtomic(
          "world/schedule.yaml",
          `- id: mod_tick
  at: "day 1 08:05"
  rule: mod_sched
`,
        );
      },
    });
    try {
      await h.engine.world.advance({ to: { day: 1, minute: 490 } });
      expect(h.engine.query("debug", "world/vars/mod.hook")).toBe(1);
    } finally {
      await h.dispose();
    }
  });
});
