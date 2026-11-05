import { describe, expect, test } from "bun:test";
import { AnimaeError } from "../../src/types.ts";
import { createFakeImagePort } from "../gallery/fake-image-port.ts";
import { seedGalleryEngineRoot } from "../gallery/fixture.ts";
import { openWorldEngine, waitGalleryJob, worldScriptedModels } from "./world-fixture.ts";
import { rulePreset } from "../helpers/rule-fixture.ts";
import type { GalleryLifecycleHooks, GalleryService } from "../../src/gallery/types.ts";

function galleryHooks(g: GalleryService): GalleryService & GalleryLifecycleHooks {
  return g as GalleryService & GalleryLifecycleHooks;
}

describe("world gallery e2e", () => {
  test("collection persistence, unlock, and gallery.unlocked event", async () => {
    const h = await openWorldEngine({
      seed: (s) => seedGalleryEngineRoot(s),
      ports: { image: createFakeImagePort("world-e2e/gallery", { kind: "instant" }) },
    });
    try {
      const locked = await h.engine.gallery.get("dawn-greenhouse");
      expect(locked?.unlocked).toBe(false);
      const item = await h.engine.gallery.unlock("dawn-greenhouse", { source: "e2e" });
      expect(item.unlocked).toBe(true);
      expect(await h.storage.exists("gallery/collection.json")).toBe(true);
      const ev = await h.engine.timeline.events({ kinds: ["gallery.unlocked"] });
      expect(ev.length).toBe(1);
      expect((ev[0] as { item?: string }).item).toBe("dawn-greenhouse");
    } finally {
      await h.dispose();
    }
  });

  test("capture with scripted S1 brief and fake ImagePort stores image bytes", async () => {
    const h = await openWorldEngine({
      seed: (s) => seedGalleryEngineRoot(s),
      models: worldScriptedModels(),
      ports: { image: createFakeImagePort("world-e2e/capture", { kind: "instant" }) },
    });
    try {
      await h.engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      const { item, job } = await h.engine.gallery.capture({ focus: "quiet table" });
      expect(item.startsWith("cap-")).toBe(true);
      const finished = await waitGalleryJob(h.engine, job!);
      expect(finished?.state).toBe("done");
      expect((await h.engine.timeline.events({ kinds: ["gallery.captured"] })).length).toBe(1);
      const got = await h.engine.gallery.get(item);
      expect(got?.image?.id).toBeTruthy();
    } finally {
      await h.dispose();
    }
  });

  test("compose uses preset render.prompt for unlocked preset render", async () => {
    const h = await openWorldEngine({
      seed: (s) => seedGalleryEngineRoot(s),
      ports: { image: createFakeImagePort("world-e2e/brief", { kind: "instant" }) },
    });
    try {
      await h.engine.gallery.unlock("dawn-greenhouse");
      const { job } = await h.engine.gallery.render("dawn-greenhouse");
      await waitGalleryJob(h.engine, job);
      const view = await h.engine.gallery.get("dawn-greenhouse");
      expect(view?.image?.id).toBeTruthy();
    } finally {
      await h.dispose();
    }
  });

  test("image sniff accepts bytes from fake port", async () => {
    const h = await openWorldEngine({
      seed: (s) => seedGalleryEngineRoot(s),
      models: worldScriptedModels(),
      ports: { image: createFakeImagePort("world-e2e/webp", { kind: "instant" }) },
    });
    try {
      await h.engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      const { job } = await h.engine.gallery.capture({});
      const finished = await waitGalleryJob(h.engine, job!);
      expect(finished?.state).toBe("done");
    } finally {
      await h.dispose();
    }
  });

  test("validation: unknown gallery id returns undefined", async () => {
    const h = await openWorldEngine({
      seed: (s) => seedGalleryEngineRoot(s),
      ports: { image: createFakeImagePort("world-e2e/val", { kind: "instant" }) },
    });
    try {
      expect(await h.engine.gallery.get("missing-entry")).toBeUndefined();
      await expect(h.engine.gallery.unlock("missing-entry")).rejects.toBeInstanceOf(AnimaeError);
    } finally {
      await h.dispose();
    }
  });

  test("rule-mode preset unlock still works without brief model", async () => {
    const h = await openWorldEngine({
      preset: rulePreset(),
      mode: "rule",
      seed: (s) => seedGalleryEngineRoot(s),
    });
    try {
      await galleryHooks(h.engine.gallery).afterTurn?.(["care"], { type: "care" });
      const item = await h.engine.gallery.get("dawn-greenhouse");
      expect(item?.unlocked).toBe(true);
    } finally {
      await h.dispose();
    }
  });
});
