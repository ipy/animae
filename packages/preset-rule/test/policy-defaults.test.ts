import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "../../engine/src/engine/create-engine.ts";
import type { Engine } from "../../engine/src/api.ts";
import type { TurnChunk } from "../../engine/src/types.ts";
import { seedE2eAuthored } from "../../engine/test/e2e/fixture.ts";
import { FsStorage } from "../../engine/src/store/fs.ts";
import { createPresetRegistry, loadPolicy } from "../../engine/src/policy/index.ts";
import { MemoryStorage } from "../../engine/src/store/memory.ts";
import presetBase from "../../preset-base/src/index.ts";
import presetRule from "../src/index.ts";

const registry = createPresetRegistry([presetBase, presetRule]);
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function ruleEngine(): Promise<{ engine: Engine; sceneId: string }> {
  const root = await mkdtemp(join(tmpdir(), "animae-preset-rule-def-"));
  const storage = FsStorage(root);
  await seedE2eAuthored(storage);
  await storage.writeAtomic("animae.yaml", 'seed: 42\npreset: "@animae/preset-rule"\npolicies: []\nmode: rule\n');
  const engine = await createEngine({
    root,
    ports: { storage },
    presets: [presetBase, presetRule],
    modelMode: "record",
    seed: 42,
    sessionId: "preset_rule_def",
  });
  cleanups.push(async () => {
    await engine.close();
    await rm(root, { recursive: true, force: true });
  });
  const sceneId = await engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
  return { engine, sceneId };
}

async function turn(engine: Engine, sceneId: string, text: string): Promise<TurnChunk[]> {
  const out: TurnChunk[] = [];
  for await (const c of engine.scene.turn({ sceneId, actor: "player", text, addressee: "npc1" })) out.push(c);
  return out;
}

describe("preset-rule policy defaults (rule backend)", () => {
  test("loads with merged appraise patterns and render layers from base", async () => {
    const storage = MemoryStorage();
    const { policy } = await loadPolicy(storage, { preset: "@animae/preset-rule", policies: [], seed: 1 }, registry);
    expect(policy.appraise.patterns!.length).toBeGreaterThan(0);
    expect(policy.render.layers!.some((l) => l.id === "refuse")).toBe(true);
    expect(policy.render.layers!.some((l) => l.id === "narration_break")).toBe(true);
    expect(policy.choices.rules!.some((r) => r.id === "comfort")).toBe(true);
  });

  test("createRuleModelPort path: engine uses rule id and comfort command maps to care", async () => {
    const { engine, sceneId } = await ruleEngine();
    expect(engine.info().models).toMatchObject({ s1: "rule", s2: "rule" });
    await turn(engine, sceneId, "Hello there!");
    await turn(engine, sceneId, "/comfort");
    const appraisals = await engine.timeline.events({ kinds: ["appraisal"] });
    expect(appraisals.at(-1)).toMatchObject({ appraisal: { type: "care" } });
  });
});
