import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "../../engine/src/engine/create-engine.ts";
import type { Engine } from "../../engine/src/api.ts";
import { seedE2eAuthored } from "../../engine/test/e2e/fixture.ts";
import { FsStorage } from "../../engine/src/store/fs.ts";
import type { TurnChunk } from "../../engine/src/types.ts";
import presetBase from "../src/index.ts";
import { generatedBundle } from "../src/generated.ts";

const en = generatedBundle.displayStrings!.en!;
const lines = (prefix: string): string[] => Object.entries(en).filter(([k]) => k.startsWith(prefix)).map(([, v]) => v);

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

/** An engine on the real preset with no model at all: the whole game runs on the rule backend. */
async function ruleEngine(): Promise<{ engine: Engine; sceneId: string }> {
  const root = await mkdtemp(join(tmpdir(), "animae-preset-base-rule-"));
  const storage = FsStorage(root);
  await seedE2eAuthored(storage);
  await storage.writeAtomic("animae.yaml", 'seed: 42\npreset: "@animae/preset-base"\npolicies: []\nmode: rule\n');
  const engine = await createEngine({ root, ports: { storage }, presets: [presetBase], modelMode: "record", seed: 42, sessionId: "pb_rule" });
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

const npcLine = (chunks: TurnChunk[]): string =>
  chunks.filter((c): c is Extract<TurnChunk, { type: "text" }> => c.type === "text" && c.speaker === "npc1").map((c) => c.text).join("");

describe("preset-base on the rule backend", () => {
  test("runs with no model: both roles are served by rule", async () => {
    const { engine } = await ruleEngine();
    expect(engine.info().models).toMatchObject({ s1: "rule", s2: "rule", s1Llm: false });
    expect(engine.runtime.mode()).toEqual({ appraise: "rule", render: "rule" });
  });

  test("praise is appraised by pattern and answered from the warm layer", async () => {
    const { engine, sceneId } = await ruleEngine();
    await turn(engine, sceneId, "Hello there!");
    const chunks = await turn(engine, sceneId, "Thank you so much, you did well");
    expect(lines("base.render.warm_")).toContain(npcLine(chunks));
    const appraisals = await engine.timeline.events({ kinds: ["appraisal"] });
    expect(appraisals.at(-1)).toMatchObject({ appraisal: { type: "praise" } });
  });

  test("an insult is appraised as such and answered from the cold layer", async () => {
    const { engine, sceneId } = await ruleEngine();
    await turn(engine, sceneId, "Hello there!");
    const chunks = await turn(engine, sceneId, "you idiot");
    expect(lines("base.render.cold_")).toContain(npcLine(chunks));
    const appraisals = await engine.timeline.events({ kinds: ["appraisal"] });
    expect(appraisals.at(-1)).toMatchObject({ appraisal: { type: "insult" } });
  });

  test("a /command carries its intensity and wins over the patterns", async () => {
    const { engine, sceneId } = await ruleEngine();
    await turn(engine, sceneId, "/care 0.9");
    const appraisals = await engine.timeline.events({ kinds: ["appraisal"] });
    expect(appraisals.at(-1)).toMatchObject({ appraisal: { type: "care", intensity: 0.9 } });
  });

  test("text no pattern knows falls back to the policy default", async () => {
    const { engine, sceneId } = await ruleEngine();
    await turn(engine, sceneId, "xyzzy plugh");
    const appraisals = await engine.timeline.events({ kinds: ["appraisal"] });
    expect(appraisals.at(-1)).toMatchObject({ appraisal: { type: "other", intensity: 0.3, sincerity: 0.5 } });
  });

  test("the first turn of a scene opens with narration naming the place", async () => {
    const { engine, sceneId } = await ruleEngine();
    const chunks = await turn(engine, sceneId, "Hello there!");
    const narration = chunks.find((c): c is Extract<TurnChunk, { type: "narration" }> => c.type === "narration");
    expect(narration).toBeDefined();
    expect(narration!.style).toBe("normal");
    expect(narration!.text).toContain("Tavern");
    expect(lines("base.narration.opening_").map((l) => l.replace("{{location.name}}", "Tavern"))).toContain(narration!.text);
  });

  test("narration is not written to memory by the preset", async () => {
    const { engine, sceneId } = await ruleEngine();
    await turn(engine, sceneId, "Hello there!");
    const events = await engine.timeline.events({ kinds: ["narration"] });
    expect(events.length).toBeGreaterThan(0);
    const memories = await engine.timeline.events({ kinds: ["memory.written"] });
    for (const m of memories) expect(JSON.stringify(m)).not.toContain("silent");
  });

  test("the player may see narration events", async () => {
    const { engine, sceneId } = await ruleEngine();
    await turn(engine, sceneId, "Hello there!");
    const seen = engine.query("player", "events") as { kind: string }[];
    expect(seen.some((e) => e.kind === "narration")).toBe(true);
    expect(seen.some((e) => e.kind === "appraisal")).toBe(false);
  });
});
