import { describe, expect, test } from "bun:test";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { buildPngWithCharaChunk } from "../../src/entities/png-chunks.ts";
import { drainTurn, openWorldEngine, worldPreset, worldScriptedModels } from "./world-fixture.ts";
import { entitiesPath } from "../../src/timeline/paths.ts";
import { rulePreset } from "../helpers/rule-fixture.ts";
import { stableStringify } from "../../src/store/util.ts";

async function writeExtraTemplate(storage: import("../../src/ports.ts").StoragePort): Promise<void> {
  await storage.writeAtomic(
    "templates/character/extra.yaml",
    `fields:
  name:
    type: string
  summary:
    type: string
    optional: true
  persona:
    type: string
guidance: e2e entity
defaults:
  tags: []
lod: extra
`,
  );
}

describe("world entities e2e", () => {
  test("entities.generate persists entity file and entity.created", async () => {
    const h = await openWorldEngine({
      seed: async (s) => {
        await writeExtraTemplate(s);
      },
    });
    try {
      const ref = await h.engine.entities.generate({ kind: "character", template: "extra", hints: { name: "Extra One" } });
      expect(ref.id.length).toBeGreaterThan(0);
      expect(await h.storage.exists(entitiesPath("main", "character", ref.id))).toBe(true);
      expect((await h.engine.timeline.events({ kinds: ["entity.created"] })).length).toBeGreaterThan(0);
    } finally {
      await h.dispose();
    }
  });

  test("generateFromBrief uses scripted S1 output", async () => {
    const h = await openWorldEngine({
      models: worldScriptedModels(),
      seed: async (s) => {
        await writeExtraTemplate(s);
      },
    });
    try {
      const ref = await h.engine.entities.generateFromBrief({
        kind: "character",
        archetype: "wanderer",
        template: "extra",
        tags: ["guest"],
        avoidNames: [],
      });
      expect(ref.id).toMatch(/^dyn-/);
    } finally {
      await h.dispose();
    }
  });

  test("spawn and retire lifecycle", async () => {
    const h = await openWorldEngine({});
    try {
      const ref = await h.engine.spawnEntity({
        kind: "character",
        card: {
          identity: { name: "Guest", summary: "Visitor", style_examples: [] },
          constraints: { motives: [], bottom_lines: [], taboos: [] },
          lod: "extra",
          tags: [],
        },
        persona: "A guest.",
        traits: { event_mult: {} },
        tracks: { self: {}, toward: {}, overrides: {} },
        goals: [],
        secrets: [],
        relations: [],
        knowledge: [],
      });
      expect(ref.id).toBeTruthy();
      await h.engine.entities.retire(ref.id);
      expect((await h.engine.timeline.events({ kinds: ["entity.retired"] })).length).toBeGreaterThan(0);
    } finally {
      await h.dispose();
    }
  });

  test("spawned locations and items join the world and survive a reopen", async () => {
    const h = await openWorldEngine({});
    try {
      const loc = await h.engine.spawnEntity({
        kind: "location",
        id: "cellar",
        name: "Wine cellar",
        summary: "Cold and damp.",
        tags: [],
        connects: [{ to: "tavern", minutes: 2 }],
        vars: { damp: true },
      });
      const item = await h.engine.spawnEntity({
        kind: "item",
        id: "lamp",
        name: "Brass lamp",
        summary: "",
        tags: [],
        holder: { kind: "character", ref: "npc1" },
        vars: {},
      });
      expect(loc).toEqual({ kind: "location", id: "cellar" });
      expect(item).toEqual({ kind: "item", id: "lamp" });
      const spawned = (await h.engine.timeline.events({ kinds: ["entity.spawned"] })) as unknown as { entity: { id: string } }[];
      expect(spawned.map((e) => e.entity.id)).toEqual(["cellar", "lamp"]);

      const check = (engine: typeof h.engine) => {
        expect(engine.query("debug", "world/locations/cellar")).toMatchObject({
          id: "cellar",
          name: "Wine cellar",
          vars: { damp: true },
          connects: [{ to: "tavern", minutes: 2 }],
        });
        const items = engine.query("debug", "world/items") as { id: string; name: string; holder: unknown }[];
        expect(items.find((i) => i.id === "lamp")).toMatchObject({ name: "Brass lamp", holder: { kind: "character", ref: "npc1" } });
      };
      check(h.engine);

      await h.engine.close();
      check(await h.reopen());
    } finally {
      await h.dispose();
    }
  });

  test("setAlias and display name", async () => {
    const h = await openWorldEngine({});
    try {
      await h.engine.entities.setAlias({ entity: "npc1", nickname: "Ace", by: "player" });
      expect(h.engine.display.entityDisplayName("npc1", { viewer: "player" })).toBe("Ace");
    } finally {
      await h.dispose();
    }
  });

  test("aliases resolve to their entity, stay unique, can be cleared, and survive a reopen", async () => {
    const h = await openWorldEngine({});
    try {
      const { engine } = h;
      await engine.entities.setAlias({ entity: "npc1", alias: "The Bard", by: "player" });
      await engine.entities.setAlias({ entity: "npc1", nickname: "Ace", by: "player" });
      // An alias is matched without regard to case, as are the names on the card.
      expect(engine.entities.resolve("the bard")).toEqual({ kind: "character", id: "npc1" });
      expect(engine.entities.resolve("ACE")).toEqual({ kind: "character", id: "npc1" });
      expect(engine.entities.resolve("aria")).toEqual({ kind: "character", id: "npc1" });

      // Nobody else may take a name that already points at someone, whether chosen by the player or found on a card.
      await expect(engine.entities.setAlias({ entity: "npc2", alias: "the bard", by: "player" })).rejects.toMatchObject({
        code: "ENTITY_DUPLICATE",
      });
      await expect(engine.entities.setAlias({ entity: "npc2", nickname: "Ace", by: "player" })).rejects.toMatchObject({
        code: "ENTITY_DUPLICATE",
      });
      await expect(engine.entities.setAlias({ entity: "npc2", alias: "Aria", by: "player" })).rejects.toMatchObject({
        code: "ENTITY_DUPLICATE",
      });
      await expect(engine.entities.setAlias({ entity: "npc2", alias: "   ", by: "player" })).rejects.toMatchObject({
        code: "ENTITY_INVALID",
      });
      expect(() => engine.entities.resolve("nobody at all")).toThrow(/no entity matches/);

      await engine.close();
      const reopened = await h.reopen();
      expect(reopened.entities.resolve("the bard")).toEqual({ kind: "character", id: "npc1" });
      expect(reopened.display.entityDisplayName("npc1", { viewer: "player" })).toBe("Ace");

      // `nickname: null` takes the nickname back: the card's own name is shown again and the nickname frees up.
      await reopened.entities.setAlias({ entity: "npc1", nickname: null, by: "player" });
      expect(reopened.display.entityDisplayName("npc1", { viewer: "player" })).toBe("Aria");
      await reopened.entities.setAlias({ entity: "npc2", nickname: "Ace", by: "player" });
      expect(() => reopened.entities.resolve("ace")).not.toThrow();
      expect(reopened.entities.resolve("ace")).toEqual({ kind: "character", id: "npc2" });
    } finally {
      await h.dispose();
    }
  });

  test("an address-as label applies to the speaker and addressee it was set for, and to nobody else", async () => {
    const h = await openWorldEngine({});
    try {
      const { engine } = h;
      await engine.entities.setAlias({ entity: "npc1", target: "player", addressLabel: "Teacher", by: "npc1" });
      const shown = (speaker?: string, viewer?: string) =>
        engine.display.entityDisplayName("npc1", { ...(speaker ? { speaker } : {}), ...(viewer ? { viewer } : {}) });
      expect(shown("npc1", "player")).toBe("Teacher");
      expect(shown("npc1", "npc2")).toBe("Aria");
      expect(shown("npc2", "player")).toBe("Aria");
      expect(shown(undefined, "player")).toBe("Aria");
      expect(shown()).toBe("Aria");
      // The label is part of the entity's alias record, which `query` exposes to the author viewer.
      expect(engine.query("debug", "characters/npc1/alias")).toMatchObject({
        addressAs: { npc1: { player: { label: "Teacher", by: "npc1" } } },
      });
    } finally {
      await h.dispose();
    }
  });

  test("importCard from SillyTavern JSON file path", async () => {
    const h = await openWorldEngine({});
    try {
      const dir = join(h.root, "imports");
      await mkdir(dir, { recursive: true });
      const path = join(dir, "card.json");
      await writeFile(
        path,
        JSON.stringify({ name: "Imported", description: "From JSON", personality: "Quiet" }),
      );
      const rel = "imports/card.json";
      await h.storage.writeAtomic(rel, await Bun.file(path).text());
      const id = await h.engine.importCard(rel);
      expect(id).toBe("imported");
      expect(await h.storage.exists(`characters/${id}/card.md`)).toBe(true);
    } finally {
      await h.dispose();
    }
  });

  test("importCard from SillyTavern PNG with chara chunk", async () => {
    const h = await openWorldEngine({});
    try {
      const card = JSON.stringify({ name: "PNG Hero", description: "png", personality: "bold" });
      const png = buildPngWithCharaChunk(Buffer.from(card, "utf8").toString("base64"));
      await h.storage.writeAtomic("imports/card.png", png);
      const id = await h.engine.importCard("imports/card.png");
      expect(id).toBeTruthy();
    } finally {
      await h.dispose();
    }
  });

  test("LOD promotion emits character.promoted", async () => {
    const h = await openWorldEngine({
      seed: async (s) => {
        await writeExtraTemplate(s);
      },
    });
    try {
      const ref = await h.engine.entities.generate({ kind: "character", template: "extra" });
      await h.engine.entities.promote(ref.id, "supporting");
      const ev = (await h.engine.timeline.events({ kinds: ["character.promoted"] }))[0] as { from?: string; to?: string };
      expect(ev?.from).toBe("extra");
      expect(ev?.to).toBe("supporting");
    } finally {
      await h.dispose();
    }
  });

  test("entity.generate from custom rule during turn with because link", async () => {
    const preset = rulePreset({
      rules: {
        thresholds: [
          {
            id: "spawn_on_turn",
            when: "true",
            repeat: true,
            emit: { kind: "entity.generate", request: { kind: "character", template: "extra" } },
          },
        ],
      },
    });
    const h = await openWorldEngine({
      preset,
      mode: "rule",
      seed: async (s) => {
        await writeExtraTemplate(s);
      },
    });
    try {
      const sceneId = await h.engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      await drainTurn(h.engine.scene.turn({ sceneId, actor: "player", text: "spawn", addressee: "npc1" }));
      const req = (await h.engine.timeline.events({ kinds: ["entity.generate"] }))[0];
      const created = (await h.engine.timeline.events({ kinds: ["entity.created"] }))[0] as { because?: string[] };
      expect(req).toBeDefined();
      expect(created?.because).toContain(req!.id);
    } finally {
      await h.dispose();
    }
  });

  test("entity.generate failure emits warning; turn still completes", async () => {
    const preset = rulePreset({
      rules: {
        thresholds: [
          {
            id: "bad_spawn",
            when: "true",
            repeat: true,
            emit: { kind: "entity.generate", request: { kind: "character", template: "missing_tpl" } },
          },
        ],
      },
    });
    const h = await openWorldEngine({ preset, mode: "rule" });
    try {
      const sceneId = await h.engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      await drainTurn(h.engine.scene.turn({ sceneId, actor: "player", text: "fail", addressee: "npc1" }));
      expect((await h.engine.timeline.events({ kinds: ["entity.generate"] })).length).toBe(1);
      expect((await h.engine.timeline.events({ kinds: ["config.warning"] })).length).toBeGreaterThan(0);
      expect((await h.engine.timeline.events({ kinds: ["turn.ended"] })).length).toBeGreaterThan(0);
    } finally {
      await h.dispose();
    }
  });

  test("reload does not regenerate entities from entity.generate requests", async () => {
    const preset = worldPreset({
      rules: {
        thresholds: [
          {
            id: "once_spawn",
            when: "true",
            repeat: false,
            emit: { kind: "entity.generate", request: { kind: "character", template: "extra" } },
          },
        ],
      },
    });
    const h = await openWorldEngine({
      preset,
      mode: "rule",
      seed: async (s) => {
        await writeExtraTemplate(s);
      },
    });
    try {
      const sceneId = await h.engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      await drainTurn(h.engine.scene.turn({ sceneId, actor: "player", text: "one", addressee: "npc1" }));
      const countAfter = (await h.engine.timeline.events({ kinds: ["entity.created"] })).length;
      const log = stableStringify(await h.engine.timeline.events());
      await h.engine.close();
      const reopened = await h.reopen({ mode: "rule", modelMode: "replay" });
      expect(stableStringify(await reopened.timeline.events())).toBe(log);
      expect((await reopened.timeline.events({ kinds: ["entity.created"] })).length).toBe(countAfter);
      await reopened.close();
    } finally {
      await h.dispose();
    }
  });
});
