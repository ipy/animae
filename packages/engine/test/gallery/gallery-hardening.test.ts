import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, utimes } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createEngine } from "../../src/engine/create-engine.ts";
import { FsStorage } from "../../src/store/fs.ts";
import { MemoryStorage } from "../../src/store/memory.ts";
import { createScriptedModel } from "../../src/model/scripted.ts";
import { e2ePreset } from "../e2e/fixture.ts";
import { seedGalleryEngineRoot } from "./fixture.ts";
import { createFakeImagePort } from "./fake-image-port.ts";
import type { GalleryLifecycleHooks, GalleryService } from "../../src/gallery/types.ts";
import { createRpcServer } from "../../src/rpc/server.ts";
import { memoryDuplex } from "../rpc/duplex.ts";
import { COLLECTION_PATH, IMAGES_DIR } from "../../src/gallery/collection.ts";
import { AnimaeError } from "../../src/types.ts";

function hooks(g: GalleryService): GalleryService & GalleryLifecycleHooks {
  return g as GalleryService & GalleryLifecycleHooks;
}

const briefOk = {
  title: "Scene",
  caption: "Cap",
  prompt: "calm interior, two people talking",
  characters: [{ name: "Player" }],
};

describe("gallery hardening", () => {
  test("unlock preset with unavailable rating still unlocks but stays hidden from list", async () => {
    const root = await mkdtemp(join(tmpdir(), "animae-gal-unlock-rating-"));
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
      await engine.gallery.unlock("hidden-moment");
      expect(await engine.gallery.get("hidden-moment")).toBeUndefined();
      const withUnavail = await engine.gallery.get("hidden-moment", { includeUnavailable: true });
      expect(withUnavail?.unlocked).toBe(true);
      expect(withUnavail?.available).toBe(false);
      await engine.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("garbage and empty port bytes mark job failed", async () => {
    const root = await mkdtemp(join(tmpdir(), "animae-gal-garbage-"));
    try {
      const storage = FsStorage(root);
      await seedGalleryEngineRoot(storage);
      const model = createScriptedModel("m/s1", (req) => (req.label === "cg_brief" ? briefOk : { text: "x" }));
      for (const kind of ["garbage", "empty"] as const) {
        const sub = await mkdtemp(join(tmpdir(), "animae-gal-garbage-sub-"));
        const subStorage = FsStorage(sub);
        await seedGalleryEngineRoot(subStorage);
        const image = createFakeImagePort("fake/test", { kind });
        const engine = await createEngine({
          root: sub,
          ports: { storage: subStorage, image },
          presets: [e2ePreset],
          models: { s1: model, s2: model },
        });
        await engine.gallery.unlock("dawn-greenhouse");
        const { job } = await engine.gallery.render("dawn-greenhouse");
        await new Promise((r) => setTimeout(r, 200));
        const j = engine.gallery.jobs().find((x) => x.id === job);
        expect(j?.state).toBe("failed");
        await engine.close();
        await rm(sub, { recursive: true, force: true });
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("cancel queued job before drain", async () => {
    const root = await mkdtemp(join(tmpdir(), "animae-gal-cancel-q-"));
    try {
      const storage = MemoryStorage(root);
      await seedGalleryEngineRoot(storage);
      const model = createScriptedModel("m/s1", (req) => (req.label === "cg_brief" ? briefOk : { text: "x" }));
      const image = createFakeImagePort("fake/test", { kind: "delay", ms: 5_000 });
      const engine = await createEngine({
        root,
        ports: { storage, image },
        presets: [e2ePreset],
        models: { s1: model, s2: model },
      });
      await engine.gallery.unlock("dawn-greenhouse");
      const jobs: string[] = [];
      for (let i = 0; i < 3; i++) jobs.push((await engine.gallery.render("dawn-greenhouse")).job);
      expect(await engine.gallery.cancel(jobs[2]!)).toBe(true);
      await new Promise((r) => setTimeout(r, 50));
      const snap = await storage.readText(COLLECTION_PATH);
      expect(snap).toContain('"state": "cancelled"');
      for (const id of jobs) await engine.gallery.cancel(id);
      await engine.close();
    } finally {
      await rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  }, 15_000);

  test("GALLERY_BUSY when queue full", async () => {
    const root = await mkdtemp(join(tmpdir(), "animae-gal-busy-"));
    try {
      const storage = MemoryStorage(root);
      await seedGalleryEngineRoot(storage);
      const model = createScriptedModel("m/s1", () => ({ text: "x" }));
      const image = createFakeImagePort("fake/test", { kind: "delay", ms: 120_000 });
      const engine = await createEngine({
        root,
        ports: { storage, image },
        presets: [e2ePreset],
        models: { s1: model, s2: model },
      });
      await engine.gallery.unlock("dawn-greenhouse");
      for (let i = 0; i < 8; i++) await engine.gallery.render("dawn-greenhouse");
      await expect(engine.gallery.render("dawn-greenhouse")).rejects.toMatchObject({ code: "GALLERY_BUSY" });
      await engine.close();
    } finally {
      await rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  }, 15_000);

  test("corrupt collection moved aside and rebuilt from images", async () => {
    const root = await mkdtemp(join(tmpdir(), "animae-gal-corrupt-"));
    try {
      const storage = FsStorage(root);
      await seedGalleryEngineRoot(storage);
      const png = createFakeImagePort("x", { kind: "instant" });
      const bytes = (await png.generate(
        { label: "cg", prompt: "p", width: 1, height: 1, rating: "general" },
        {},
      )).bytes;
      const { imageIdFromBytes } = await import("../../src/gallery/collection.ts");
      const imageId = imageIdFromBytes(bytes);
      await storage.writeAtomic(`${IMAGES_DIR}/${imageId}.png`, bytes);
      await storage.writeAtomic(COLLECTION_PATH, "{ not json");
      const model = createScriptedModel("m/s1", () => ({ text: "x" }));
      const engine = await createEngine({
        root,
        ports: { storage },
        presets: [e2ePreset],
        models: { s1: model, s2: model },
      });
      await new Promise((r) => setTimeout(r, 80));
      const corruptFiles = (await storage.listFiles("gallery")).filter((p) => p.includes("corrupt"));
      expect(corruptFiles.length).toBeGreaterThan(0);
      const list = await engine.gallery.list();
      expect(list.some((i) => i.kind === "captured")).toBe(true);
      await engine.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("unavailable rating notices suppressed", async () => {
    const root = await mkdtemp(join(tmpdir(), "animae-gal-notice-"));
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
      const notices: string[] = [];
      engine.gallery.subscribe((n) => {
        if (n.type === "unlocked" || n.type === "changed") notices.push(n.item);
      });
      await engine.gallery.unlock("hidden-moment");
      expect(notices.includes("hidden-moment")).toBe(false);
      await engine.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("prune emits gallery.removed event", async () => {
    const root = await mkdtemp(join(tmpdir(), "animae-gal-prune-ev-"));
    try {
      const storage = FsStorage(root);
      await seedGalleryEngineRoot(storage);
      const yaml = (await storage.readText("animae.yaml")) ?? "";
      await storage.writeAtomic("animae.yaml", yaml.replace("gallery:\n", "gallery:\n  maxCaptured: 1\n"));
      const model = createScriptedModel("m/s1", (req) => (req.label === "cg_brief" ? briefOk : { text: "x" }));
      const image = createFakeImagePort("fake/test", { kind: "instant" });
      const engine = await createEngine({
        root,
        ports: { storage, image },
        presets: [e2ePreset],
        models: { s1: model, s2: model },
      });
      await engine.scene.start({ location: "tavern", participants: ["player"] });
      await engine.gallery.capture();
      await new Promise((r) => setTimeout(r, 150));
      await engine.gallery.capture();
      await new Promise((r) => setTimeout(r, 150));
      const removed = await engine.timeline.events({ kinds: ["gallery.removed"] });
      expect(removed.length).toBeGreaterThan(0);
      await engine.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("RPC gallery.image round trip", async () => {
    const root = await mkdtemp(join(tmpdir(), "animae-gal-rpc-"));
    try {
      const storage = FsStorage(root);
      await seedGalleryEngineRoot(storage);
      const model = createScriptedModel("m/s1", (req) => (req.label === "cg_brief" ? briefOk : { text: "x" }));
      const image = createFakeImagePort("fake/test", { kind: "instant" });
      const engine = await createEngine({
        root,
        ports: { storage, image },
        presets: [e2ePreset],
        models: { s1: model, s2: model },
      });
      await engine.gallery.unlock("dawn-greenhouse");
      await engine.gallery.render("dawn-greenhouse");
      await new Promise((r) => setTimeout(r, 200));
      const io = memoryDuplex();
      const server = createRpcServer(engine, io);
      const run = server.run();
      io.push(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "gallery.list", params: { opts: {} } }));
      io.push(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "gallery.image", params: { id: "dawn-greenhouse" } }));
      io.close();
      await run;
      const imgMsg = io.written.map((l) => JSON.parse(l) as { id?: number; result?: { base64: string } }).find((m) => m.id === 2);
      expect(imgMsg?.result?.base64).toBeTruthy();
      const parsed = { result: imgMsg!.result! };
      expect(parsed.result.base64.length).toBeGreaterThan(10);
      await engine.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("50 mixed operations keep collection consistent", async () => {
    const root = await mkdtemp(join(tmpdir(), "animae-gal-stress-"));
    try {
      const storage = MemoryStorage(root);
      await seedGalleryEngineRoot(storage);
      const yaml = (await storage.readText("animae.yaml")) ?? "";
      await storage.writeAtomic("animae.yaml", yaml.replace("gallery:\n", "gallery:\n  maxCaptured: 5\n"));
      const model = createScriptedModel("m/s1", (req) => (req.label === "cg_brief" ? briefOk : { text: "x" }));
      const image = createFakeImagePort("fake/test", { kind: "instant" });
      const engine = await createEngine({
        root,
        ports: { storage, image },
        presets: [e2ePreset],
        models: { s1: model, s2: model },
      });
      await engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      const capIds: string[] = [];
      for (let i = 0; i < 50; i++) {
        switch (i % 7) {
          case 0:
            await engine.gallery.unlock("dawn-greenhouse", { source: "stress" });
            break;
          case 1:
            capIds.push((await engine.gallery.capture({ focus: `f${i}` })).item);
            break;
          case 2:
            await engine.gallery.render("dawn-greenhouse");
            break;
          case 3: {
            const id = capIds[capIds.length - 1];
            if (id) await engine.gallery.pin(id, i % 2 === 0);
            break;
          }
          case 4: {
            const jobs = engine.gallery.jobs();
            if (jobs[0]) await engine.gallery.cancel(jobs[0].id);
            break;
          }
          case 5:
            await hooks(engine.gallery).afterTurn?.(["dialogue"], { type: "care" });
            break;
          case 6: {
            const id = capIds[0];
            if (id && i > 20) {
              try {
                await engine.gallery.remove(id);
                capIds.shift();
              } catch {
                /* may already be pruned */
              }
            }
            break;
          }
        }
        if (i % 5 === 0) await new Promise((r) => setTimeout(r, 5));
      }
      await new Promise((r) => setTimeout(r, 400));
      const list = await engine.gallery.list();
      const caps = list.filter((c) => c.kind === "captured");
      expect(caps.length).toBeLessThanOrEqual(5);
      for (const c of caps) {
        expect(c.id.startsWith("cap-")).toBe(true);
      }
      const text = await storage.readText(COLLECTION_PATH);
      expect(text).toBeTruthy();
      JSON.parse(text!);
      await engine.close();
    } finally {
      await rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  }, 60_000);

  test("orphan image cleanup on startup", async () => {
    const root = await mkdtemp(join(tmpdir(), "animae-gal-orphan-"));
    try {
      const storage = FsStorage(root);
      await seedGalleryEngineRoot(storage);
      await storage.writeAtomic(COLLECTION_PATH, JSON.stringify({ version: 1, unlocks: {}, presetImages: {}, captured: [], jobs: [] }));
      const orphan = `${IMAGES_DIR}/deadbeefdeadbeef.png`;
      await storage.writeAtomic(orphan, Uint8Array.from([0x89, 0x50, 0x4e, 0x47]));
      const full = join(root, orphan);
      const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
      await utimes(full, old, old);
      const model = createScriptedModel("m/s1", () => ({ text: "x" }));
      const engine = await createEngine({
        root,
        ports: { storage },
        presets: [e2ePreset],
        models: { s1: model, s2: model },
      });
      await new Promise((r) => setTimeout(r, 80));
      expect(await storage.exists(orphan)).toBe(false);
      await engine.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("sanitize focus strips control characters", async () => {
    const root = await mkdtemp(join(tmpdir(), "animae-gal-focus-"));
    try {
      const storage = FsStorage(root);
      await seedGalleryEngineRoot(storage);
      const model = createScriptedModel("m/s1", (req) => (req.label === "cg_brief" ? briefOk : { text: "x" }));
      const image = createFakeImagePort("fake/test", { kind: "instant" });
      const engine = await createEngine({
        root,
        ports: { storage, image },
        presets: [e2ePreset],
        models: { s1: model, s2: model },
      });
      await engine.scene.start({ location: "tavern", participants: ["player"] });
      const { item } = await engine.gallery.capture({ focus: "hello\u0000world" });
      await new Promise((r) => setTimeout(r, 150));
      const raw = await storage.readText(COLLECTION_PATH);
      expect(raw).toContain("hello world");
      expect(raw).not.toContain("\\u0000");
      const got = await engine.gallery.get(item);
      expect(got?.image?.id).toBeTruthy();
      await engine.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("brief invalid after retry throws GALLERY_BRIEF_INVALID", async () => {
    const root = await mkdtemp(join(tmpdir(), "animae-gal-brief-bad-"));
    try {
      const storage = FsStorage(root);
      await seedGalleryEngineRoot(storage);
      const model = createScriptedModel("m/s1", (req) => {
        if (req.label === "cg_brief") return { title: 1, prompt: "x", characters: [] };
        return { text: "x" };
      });
      const image = createFakeImagePort("fake/test", { kind: "instant" });
      const engine = await createEngine({
        root,
        ports: { storage, image },
        presets: [e2ePreset],
        models: { s1: model, s2: model },
      });
      await engine.scene.start({ location: "tavern", participants: ["player"] });
      const { job } = await engine.gallery.capture();
      await new Promise((r) => setTimeout(r, 250));
      const j = engine.gallery.jobs().find((x) => x.id === job);
      expect(j?.state).toBe("failed");
      expect(j?.error?.code).toBe("GALLERY_BRIEF_INVALID");
      await engine.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("gallery util validate", () => {
  test("path traversal rejected at validate", async () => {
    const root = await mkdtemp(join(tmpdir(), "animae-gal-path-"));
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
      hint: h
      rating: general
      image:
        src: ../secrets.png
`,
      );
      await expect(
        createEngine({
          root,
          ports: { storage },
          presets: [e2ePreset],
          models: { s1: createScriptedModel("m/s1", () => ({ text: "x" })), s2: createScriptedModel("m/s1", () => ({ text: "x" })) },
        }),
      ).rejects.toBeInstanceOf(AnimaeError);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
