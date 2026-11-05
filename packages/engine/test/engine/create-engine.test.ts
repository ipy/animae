import { test, expect, describe } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "../../src/engine/create-engine.ts";
import { FsStorage } from "../../src/store/fs.ts";
import { createScriptedModel } from "../../src/model/scripted.ts";
import { AnimaeError } from "../../src/types.ts";
import { e2ePreset, seedE2eAuthored } from "../e2e/fixture.ts";

describe("createEngine models", () => {
  test("no ports and no animae.yaml models: the engine runs on the rule backend", async () => {
    const root = await mkdtemp(join(tmpdir(), "animae-no-models-"));
    try {
      await seedE2eAuthored(FsStorage(root));
      const engine = await createEngine({ root, ports: { storage: FsStorage(root) }, presets: [e2ePreset] });
      expect(engine.info().models).toMatchObject({ s1: "rule", s2: "rule", s1Llm: false, s2Tiers: [] });
      expect(engine.runtime.mode()).toEqual({ appraise: "rule", render: "rule" });
      await engine.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("a role without a model is served by rule while the other keeps its model", async () => {
    const root = await mkdtemp(join(tmpdir(), "animae-partial-models-"));
    try {
      await seedE2eAuthored(FsStorage(root));
      const s1 = createScriptedModel("only/s1", () => ({ text: "x" }));
      const engine = await createEngine({
        root,
        ports: { storage: FsStorage(root) },
        presets: [e2ePreset],
        models: { s1 },
      });
      expect(engine.info().models).toMatchObject({ s1: "only/s1", s2: "rule", s1Llm: true, s2Tiers: [] });
      expect(engine.runtime.mode()).toEqual({ appraise: "llm", render: "rule" });
      await expect(engine.runtime.setMode({ render: "llm" })).rejects.toMatchObject({ code: "MODE_UNAVAILABLE" });
      await engine.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("an object that is not a ModelPort is a configuration error", async () => {
    const root = await mkdtemp(join(tmpdir(), "animae-bad-models-"));
    try {
      await seedE2eAuthored(FsStorage(root));
      await expect(
        createEngine({
          root,
          ports: { storage: FsStorage(root) },
          presets: [e2ePreset],
          models: { s1: { not: "a port" } as never },
        }),
      ).rejects.toMatchObject({ code: "MODEL_CONFIG" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("S2 tiers given by the embedder: default tier first, escalation tier named in routing", async () => {
    const root = await mkdtemp(join(tmpdir(), "animae-tiers-"));
    try {
      await seedE2eAuthored(FsStorage(root));
      const std = createScriptedModel("t/std", () => ({ text: "x" }));
      const pro = createScriptedModel("t/pro", () => ({ text: "x" }));
      const engine = await createEngine({
        root,
        ports: { storage: FsStorage(root) },
        presets: [e2ePreset],
        models: {
          s2: { default: "standard", tiers: [{ id: "standard", port: std }, { id: "pro", port: pro }], routing: { escalate_to: "pro" } },
        },
      });
      expect(engine.info().models.s2Tiers.map((t) => t.id)).toEqual(["standard", "pro"]);
      expect(engine.info().models).toMatchObject({ s2: "t/std", s2Default: "standard", s2Escalate: "pro" });
      await engine.close();
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
