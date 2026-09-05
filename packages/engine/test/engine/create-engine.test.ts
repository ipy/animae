import { test, expect, describe } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "../../src/engine/create-engine.ts";
import { FsStorage } from "../../src/store/fs.ts";
import { createScriptedModel } from "../../src/model/scripted.ts";
import { AnimaeError } from "../../src/types.ts";
import { e2ePreset, seedE2eAuthored } from "../e2e/fixture.ts";

describe("createEngine models (§19.3)", () => {
  test("rejects missing both ports and animae.yaml models", async () => {
    const root = await mkdtemp(join(tmpdir(), "animae-no-models-"));
    try {
      await seedE2eAuthored(FsStorage(root));
      await expect(
        createEngine({ root, ports: { storage: FsStorage(root) }, presets: [e2ePreset] }),
      ).rejects.toMatchObject({ code: "MODEL_CONFIG" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects partial ModelPorts in opts", async () => {
    const root = await mkdtemp(join(tmpdir(), "animae-partial-models-"));
    try {
      await seedE2eAuthored(FsStorage(root));
      const s1 = createScriptedModel("only/s1", () => ({ text: "x" }));
      await expect(
        createEngine({
          root,
          ports: { storage: FsStorage(root) },
          presets: [e2ePreset],
          models: { s1, s2: undefined as never },
        }),
      ).rejects.toMatchObject({ code: "MODEL_CONFIG" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("modelMode defaults to record", async () => {
    const root = await mkdtemp(join(tmpdir(), "animae-mode-"));
    try {
      const storage = FsStorage(root);
      await seedE2eAuthored(storage);
      const model = createScriptedModel("m/s1", () => ({ text: "ok" }));
      const engine = await createEngine({
        root,
        ports: { storage },
        presets: [e2ePreset],
        models: { s1: model, s2: model },
      });
      expect(engine.info().modelMode).toBe("record");
      await engine.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
