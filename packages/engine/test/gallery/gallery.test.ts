import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "../../src/engine/create-engine.ts";
import { FsStorage } from "../../src/store/fs.ts";
import { createScriptedModel } from "../../src/model/scripted.ts";
import { e2ePreset } from "../e2e/fixture.ts";
import { seedGalleryEngineRoot } from "./fixture.ts";
import { createFakeImagePort } from "./fake-image-port.ts";
import { AnimaeError } from "../../src/types.ts";
import type { GalleryLifecycleHooks, GalleryService } from "../../src/gallery/types.ts";

function galleryHooks(g: GalleryService): GalleryService & GalleryLifecycleHooks {
  return g as GalleryService & GalleryLifecycleHooks;
}

describe("gallery service", () => {
  test("unlock idempotent and locked masking", async () => {
    const root = await mkdtemp(join(tmpdir(), "animae-gallery-"));
    try {
      const storage = FsStorage(root);
      await seedGalleryEngineRoot(storage);
      const model = createScriptedModel("m/s1", () => ({ text: "x" }));
      const image = createFakeImagePort("fake/test", { kind: "instant" }, ["tier:general"]);
      const engine = await createEngine({
        root,
        ports: { storage, image },
        presets: [e2ePreset],
        models: { s1: model, s2: model },
      });
      const locked = await engine.gallery.get("dawn-greenhouse");
      expect(locked?.unlocked).toBe(false);
      expect(locked?.hint).toContain("plants");
      expect(locked?.title).toBe("");
      expect(locked?.caption).toBeUndefined();

      await engine.gallery.unlock("dawn-greenhouse", { source: "test" });
      const again = await engine.gallery.unlock("dawn-greenhouse");
      expect(again.unlocked).toBe(true);
      expect(again.title).toContain("Dawn");

      const events = await engine.timeline.events({ kinds: ["gallery.unlocked"] });
      expect(events.length).toBe(1);
      await engine.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rating gating with image.tags CEL", async () => {
    const root = await mkdtemp(join(tmpdir(), "animae-gallery-rating-"));
    try {
      const storage = FsStorage(root);
      await seedGalleryEngineRoot(storage);
      const model = createScriptedModel("m/s1", () => ({ text: "x" }));
      const image = createFakeImagePort("fake/test", { kind: "instant" }, ["tier:general"]);
      const engine = await createEngine({
        root,
        ports: { storage, image },
        presets: [e2ePreset],
        models: { s1: model, s2: model },
      });
      const list = await engine.gallery.list();
      expect(list.some((i) => i.id === "hidden-moment")).toBe(false);
      const ratings = engine.gallery.ratings();
      expect(ratings.find((r) => r.id === "restricted")?.available).toBe(false);
      await engine.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("capture and render with fake ImagePort", async () => {
    const root = await mkdtemp(join(tmpdir(), "animae-gallery-cap-"));
    try {
      const storage = FsStorage(root);
      await seedGalleryEngineRoot(storage);
      const brief = {
        title: "Quiet moment",
        caption: "A pause.",
        prompt: "two friends at a tavern table, warm light",
        characters: [{ name: "Player" }, { name: "Aria" }],
      };
      const model = createScriptedModel("m/s1", (req) => {
        if (req.label === "cg_brief") return brief;
        return { text: "ok" };
      });
      const image = createFakeImagePort("fake/test", { kind: "instant" });
      const engine = await createEngine({
        root,
        ports: { storage, image },
        presets: [e2ePreset],
        models: { s1: model, s2: model },
      });
      await engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      const { item, job } = await engine.gallery.capture({ focus: "table talk" });
      expect(item.startsWith("cap-")).toBe(true);
      expect(job).toMatch(/^job_/);
      await new Promise((r) => setTimeout(r, 200));
      const got = await engine.gallery.get(item);
      expect(got?.image?.id).toBeTruthy();
      expect(image.calls.length).toBe(1);
      await engine.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("GALLERY_NO_GENERATOR when capture without port", async () => {
    const root = await mkdtemp(join(tmpdir(), "animae-gallery-nogen-"));
    try {
      const storage = FsStorage(root);
      await seedGalleryEngineRoot(storage);
      const model = createScriptedModel("m/s1", () => ({ text: "x" }));
      const engine = await createEngine({
        root,
        ports: { storage },
        presets: [e2ePreset],
        models: { s1: model, s2: model },
      });
      await expect(engine.gallery.capture()).rejects.toMatchObject({ code: "GALLERY_NO_GENERATOR" });
      await engine.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("cancel mid-render", async () => {
    const root = await mkdtemp(join(tmpdir(), "animae-gallery-cancel-"));
    try {
      const storage = FsStorage(root);
      await seedGalleryEngineRoot(storage);
      const model = createScriptedModel("m/s1", () => ({ text: "x" }));
      const image = createFakeImagePort("fake/test", { kind: "delay", ms: 60_000 });
      const engine = await createEngine({
        root,
        ports: { storage, image },
        presets: [e2ePreset],
        models: { s1: model, s2: model },
      });
      await engine.gallery.unlock("dawn-greenhouse");
      const { job } = await engine.gallery.render("dawn-greenhouse");
      await new Promise((r) => setTimeout(r, 80));
      expect(await engine.gallery.cancel(job)).toBe(true);
      await new Promise((r) => setTimeout(r, 100));
      const view = engine.gallery.jobs().find((j) => j.id === job);
      expect(view?.state === "cancelled" || view?.state === "failed").toBe(true);
      await engine.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 15_000);

  test("unlock via CEL afterTurn hook", async () => {
    const root = await mkdtemp(join(tmpdir(), "animae-gallery-cel-unlock-"));
    try {
      const storage = FsStorage(root);
      await seedGalleryEngineRoot(storage);
      const model = createScriptedModel("m/s1", () => ({ text: "x" }));
      const image = createFakeImagePort("fake/test", { kind: "instant" });
      const engine = await createEngine({
        root,
        ports: { storage, image },
        presets: [e2ePreset],
        models: { s1: model, s2: model },
      });
      await galleryHooks(engine.gallery).afterTurn?.([], { type: "care" });
      const item = await engine.gallery.get("dawn-greenhouse");
      expect(item?.unlocked).toBe(true);
      await engine.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("locked preset image() returns undefined", async () => {
    const root = await mkdtemp(join(tmpdir(), "animae-gallery-img-gate-"));
    try {
      const storage = FsStorage(root);
      await seedGalleryEngineRoot(storage);
      const model = createScriptedModel("m/s1", () => ({ text: "x" }));
      const engine = await createEngine({
        root,
        ports: { storage },
        presets: [e2ePreset],
        models: { s1: model, s2: model },
      });
      expect(await engine.gallery.image("dawn-greenhouse")).toBeUndefined();
      await engine.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("restart marks orphaned jobs interrupted", async () => {
    const root = await mkdtemp(join(tmpdir(), "animae-gallery-restart-"));
    try {
      const storage = FsStorage(root);
      await seedGalleryEngineRoot(storage);
      await storage.writeAtomic(
        "gallery/collection.json",
        JSON.stringify({
          version: 1,
          unlocks: { "dawn-greenhouse": { day: 1, minute: 0, at: "2020-01-01T00:00:00.000Z" } },
          presetImages: {},
          captured: [],
          jobs: [{ id: "job_stale", item: "dawn-greenhouse", state: "rendering", startedAt: "2020-01-01T00:00:00.000Z" }],
        }),
      );
      const model = createScriptedModel("m/s1", () => ({ text: "x" }));
      const image = createFakeImagePort("fake/test", { kind: "instant" });
      const engine = await createEngine({
        root,
        ports: { storage, image },
        presets: [e2ePreset],
        models: { s1: model, s2: model },
      });
      await new Promise((r) => setTimeout(r, 50));
      const stale = engine.gallery.jobs().find((j) => j.id === "job_stale");
      expect(stale?.state).toBe("failed");
      expect(stale?.error?.code).toBe("interrupted");
      await engine.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("cg_brief retries once on invalid model output", async () => {
    const root = await mkdtemp(join(tmpdir(), "animae-gallery-brief-retry-"));
    try {
      const storage = FsStorage(root);
      await seedGalleryEngineRoot(storage);
      let briefCalls = 0;
      const goodBrief = {
        title: "Retry ok",
        caption: "After one bad try.",
        prompt: "friends sharing tea indoors",
        characters: [{ name: "Player" }],
      };
      const model = createScriptedModel("m/s1", (req) => {
        if (req.label === "cg_brief") {
          briefCalls += 1;
          if (briefCalls === 1) return { title: 1, prompt: "x", characters: [] };
          return goodBrief;
        }
        return { text: "ok" };
      });
      const image = createFakeImagePort("fake/test", { kind: "instant" });
      const engine = await createEngine({
        root,
        ports: { storage, image },
        presets: [e2ePreset],
        models: { s1: model, s2: model },
      });
      await engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      const { item } = await engine.gallery.capture();
      await new Promise((r) => setTimeout(r, 250));
      expect(briefCalls).toBe(2);
      const got = await engine.gallery.get(item);
      expect(got?.title).toBe("Retry ok");
      await engine.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("maxCaptured pruning respects pin", async () => {
    const root = await mkdtemp(join(tmpdir(), "animae-gallery-prune-"));
    try {
      const storage = FsStorage(root);
      await seedGalleryEngineRoot(storage);
      const yaml = (await storage.readText("animae.yaml")) ?? "";
      await storage.writeAtomic("animae.yaml", yaml.replace("gallery:\n", "gallery:\n  maxCaptured: 1\n"));
      const brief = {
        title: "Cap",
        caption: "c",
        prompt: "still life",
        characters: [{ name: "Player" }],
      };
      const model = createScriptedModel("m/s1", (req) => (req.label === "cg_brief" ? brief : { text: "x" }));
      const image = createFakeImagePort("fake/test", { kind: "instant" });
      const engine = await createEngine({
        root,
        ports: { storage, image },
        presets: [e2ePreset],
        models: { s1: model, s2: model },
      });
      await engine.scene.start({ location: "tavern", participants: ["player"] });
      const first = await engine.gallery.capture({ title: "keep" });
      await new Promise((r) => setTimeout(r, 150));
      await engine.gallery.pin(first.item, true);
      const second = await engine.gallery.capture({ title: "drop" });
      await new Promise((r) => setTimeout(r, 150));
      const third = await engine.gallery.capture({ title: "newest" });
      await new Promise((r) => setTimeout(r, 150));
      const list = await engine.gallery.list();
      const caps = list.filter((i) => i.kind === "captured");
      expect(caps.some((c) => c.id === first.item)).toBe(true);
      expect(caps.some((c) => c.id === second.item)).toBe(false);
      expect(caps.some((c) => c.id === third.item)).toBe(true);
      await engine.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 20_000);

  test("timeline replay does not call ImagePort again", async () => {
    const root = await mkdtemp(join(tmpdir(), "animae-gallery-replay-"));
    try {
      const storage = FsStorage(root);
      await seedGalleryEngineRoot(storage);
      const model = createScriptedModel("m/s1", () => ({ text: "x" }));
      const image = createFakeImagePort("fake/test", { kind: "instant" });
      const engine = await createEngine({
        root,
        ports: { storage, image },
        presets: [e2ePreset],
        models: { s1: model, s2: model },
      });
      await engine.gallery.unlock("dawn-greenhouse");
      await engine.gallery.render("dawn-greenhouse");
      await new Promise((r) => setTimeout(r, 300));
      const callsAfterRender = image.calls.length;
      expect(callsAfterRender).toBe(1);
      for await (const _ of engine.timeline.replay("main")) {
        /* drain */
      }
      expect(image.calls.length).toBe(callsAfterRender);
      await engine.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("gallery validate", () => {
  test("requires hint when unlock.when set", async () => {
    const root = await mkdtemp(join(tmpdir(), "animae-gallery-val-"));
    try {
      const storage = FsStorage(root);
      await seedGalleryEngineRoot(storage);
      await storage.writeAtomic(
        "animae.yaml",
        `seed: 7
preset: e2e
policies: []
gallery:
  entries:
    bad:
      title: X
      rating: general
      unlock:
        when: "true"
`,
      );
      const model = createScriptedModel("m/s1", () => ({ text: "x" }));
      await expect(
        createEngine({
          root,
          ports: { storage },
          presets: [e2ePreset],
          models: { s1: model, s2: model },
        }),
      ).rejects.toBeInstanceOf(AnimaeError);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
