import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createEngine } from "../../src/engine/create-engine.ts";
import { FsStorage } from "../../src/store/fs.ts";
import { createScriptedModel } from "../../src/model/scripted.ts";
import { e2ePreset } from "../e2e/fixture.ts";
import { seedGalleryEngineRoot } from "./fixture.ts";
import { createFakeImagePort } from "./fake-image-port.ts";

describe("gallery generatorAvailable", () => {
  test("false when ImagePort.available() is false", async () => {
    const root = await mkdtemp(join(tmpdir(), "animae-gen-avail-"));
    try {
      const storage = FsStorage(root);
      await seedGalleryEngineRoot(storage);
      const model = createScriptedModel("m/s1", () => ({ text: "x" }));
      const image = createFakeImagePort("fake/test", { kind: "instant" });
      image.available = () => false;
      const engine = await createEngine({
        root,
        ports: { storage, image },
        presets: [e2ePreset],
        models: { s1: model, s2: model },
      });
      expect(engine.gallery.generatorAvailable()).toBe(false);
      await expect(engine.gallery.capture()).rejects.toMatchObject({ code: "GALLERY_NO_GENERATOR" });
      await engine.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  test("a queued job fails visibly when the generator disappears before it runs", async () => {
    const root = await mkdtemp(join(tmpdir(), "animae-gen-gone-"));
    try {
      const storage = FsStorage(root);
      await seedGalleryEngineRoot(storage);
      const model = createScriptedModel("m/s1", () => ({ text: "x" }));
      const image = createFakeImagePort("fake/test", { kind: "delay", ms: 60_000 });
      let up = true;
      image.available = () => up;
      const engine = await createEngine({
        root,
        ports: { storage, image },
        presets: [e2ePreset],
        models: { s1: model, s2: model },
      });
      await engine.gallery.unlock("dawn-greenhouse");
      const first = await engine.gallery.render("dawn-greenhouse");
      const second = await engine.gallery.render("dawn-greenhouse");
      await new Promise((r) => setTimeout(r, 80));
      up = false;
      expect(await engine.gallery.cancel(first.job)).toBe(true);
      await new Promise((r) => setTimeout(r, 150));
      const view = engine.gallery.jobs().find((j) => j.id === second.job);
      expect(view?.state).toBe("failed");
      expect(view?.error?.code).toBe("GALLERY_NO_GENERATOR");
      await engine.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 15_000);
});
