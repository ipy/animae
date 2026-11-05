import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Engine } from "../../engine/src/api.ts";
import { createEngine } from "../../engine/src/engine/create-engine.ts";
import { FsStorage } from "../../engine/src/store/fs.ts";
import type { TurnChunk } from "../../engine/src/types.ts";
import { seedE2eAuthored } from "../../engine/test/e2e/fixture.ts";
import presetBase from "../../preset-base/src/index.ts";
import presetRule from "../src/index.ts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function ruleEngine(): Promise<{ engine: Engine; sceneId: string }> {
  const root = await mkdtemp(join(tmpdir(), "animae-preset-rule-"));
  const storage = FsStorage(root);
  await seedE2eAuthored(storage);
  await storage.writeAtomic("animae.yaml", 'seed: 42\npreset: "@animae/preset-rule"\npolicies: []\nmode: rule\n');
  const engine = await createEngine({
    root,
    ports: { storage },
    presets: [presetBase, presetRule],
    modelMode: "record",
    seed: 42,
    sessionId: "preset_rule",
  });
  cleanups.push(async () => {
    await engine.close();
    await rm(root, { recursive: true, force: true });
  });
  const sceneId = await engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
  return { engine, sceneId };
}

async function turn(engine: Engine, sceneId: string, input: { text: string; choiceId?: string }): Promise<TurnChunk[]> {
  const out: TurnChunk[] = [];
  for await (const c of engine.scene.turn({ sceneId, actor: "player", addressee: "npc1", ...input })) out.push(c);
  return out;
}

describe("preset-rule", () => {
  test("offers quick replies on every turn and the taken one decides the appraisal", async () => {
    const { engine, sceneId } = await ruleEngine();
    const first = await turn(engine, sceneId, { text: "Hello there!" });
    const offered = first.find((c): c is Extract<TurnChunk, { type: "choices" }> => c.type === "choices");
    expect(offered).toBeDefined();
    expect(offered!.choices.length).toBe(3);
    const taken = offered!.choices.find((c) => c.expected_event_type === "care") ?? offered!.choices[0]!;
    await turn(engine, sceneId, { text: taken.text, choiceId: taken.id });
    const appraisals = await engine.timeline.events({ kinds: ["appraisal"] });
    expect(appraisals.at(-1)).toMatchObject({ appraisal: { type: taken.expected_event_type } });
  });

  test("memories carry the per-event-type importance", async () => {
    const { engine, sceneId } = await ruleEngine();
    await turn(engine, sceneId, { text: "you idiot" });
    const insult = (await engine.timeline.events({ kinds: ["memory.written"] })) as unknown as { importance: number }[];
    expect(insult.map((m) => m.importance)).toEqual([0.8]);
    await turn(engine, sceneId, { text: "Hello there!" });
    const all = (await engine.timeline.events({ kinds: ["memory.written"] })) as unknown as { importance: number }[];
    expect(all.map((m) => m.importance)).toEqual([0.8, 0.2]);
  });
});
