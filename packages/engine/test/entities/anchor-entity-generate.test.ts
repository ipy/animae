import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createEngine } from "../../src/engine/create-engine.ts";
import { FsStorage } from "../../src/store/fs.ts";
import { seedE2eAuthored } from "../e2e/fixture.ts";
import { e2ePreset } from "../e2e/fixture.ts";
import type { ModelPort } from "../../src/ports.ts";

function scriptedS1(name: string): ModelPort {
  return {
    id: "test/s1",
    async object(req) {
      if (req.purpose === "appraise" || req.label === "appraise") {
        return {
          type: "chat",
          intensity: 0.4,
          sincerity: 0.8,
          claims: [],
          search_terms: [],
          tags: [],
          input_class: "normal",
        } as never;
      }
      return { name, persona: "Spawned by anchor fallback." } as never;
    },
    async *stream(req) {
      yield { type: "final", value: await this.object(req as never) };
    },
  };
}

async function seedAnchor(root: string): Promise<void> {
  await mkdir(join(root, "templates/character"), { recursive: true });
  await writeFile(
    join(root, "world/anchors.yaml"),
    `- id: gen-fallback
  target:
    kind: character_choice
    spec:
      character: player
      choice: never
  deadline:
    day: 1
    minute: 490
  strategies:
    - hard
  hard:
    - kind: entity.generate
      request:
        kind: character
        template: extra
  refs: []
`,
  );
  await writeFile(
    join(root, "templates/character/extra.yaml"),
    `fields:
  name: { type: string }
  persona: { type: string }
guidance: t
defaults: {}
lod: extra
`,
  );
}

async function openWithAnchor(opts: { mode?: "rule"; s1?: ModelPort }) {
  const root = await mkdtemp(join(tmpdir(), "animae-anchor-eg-"));
  await seedE2eAuthored(FsStorage(root));
  await seedAnchor(root);
  const storage = FsStorage(root);
  const engine = await createEngine({
    root,
    ports: { storage },
    presets: [e2ePreset],
    ...(opts.mode === "rule" ? { mode: "rule" } : { models: { s1: opts.s1 ?? scriptedS1("Anchor Spawn") }, modelMode: "record" }),
  });
  return { engine, root, storage };
}

describe("anchor hard entity.generate", () => {
  test("LLM mode: deadline unmet -> fallback chain creates entity with because link", async () => {
    const { engine, root } = await openWithAnchor({ s1: scriptedS1("Anchor LLM") });
    try {
      await engine.world.advance(15);
      const events = await engine.timeline.events();
      expect(events.some((e) => e.kind === "anchor.fallback")).toBe(true);
      const req = events.find((e) => e.kind === "entity.generate");
      const created = events.find((e) => e.kind === "entity.created") as { because?: string[] } | undefined;
      expect(req).toBeDefined();
      expect(created).toBeDefined();
      expect(created!.because).toContain(req!.id);
    } finally {
      await engine.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rule mode: procedural entity generation from anchor hard draft", async () => {
    const { engine, root } = await openWithAnchor({ mode: "rule" });
    try {
      await engine.world.advance(15);
      expect((await engine.timeline.events()).some((e) => e.kind === "entity.created")).toBe(true);
    } finally {
      await engine.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("replay load rewind do not duplicate entity.created", async () => {
    const { engine, root, storage } = await openWithAnchor({ s1: scriptedS1("Once") });
    try {
      await engine.world.advance(15);
      expect((await engine.timeline.events()).filter((e) => e.kind === "entity.created").length).toBe(1);
      const head = (await engine.timeline.events()).at(-1)!.id;
      await engine.close();
      const replay = await createEngine({ root, ports: { storage }, presets: [e2ePreset], modelMode: "replay" });
      expect((await replay.timeline.events()).filter((e) => e.kind === "entity.created").length).toBe(1);
      await replay.close();
      const again = await createEngine({ root, ports: { storage }, presets: [e2ePreset], models: { s1: scriptedS1("X") }, modelMode: "record" });
      await again.timeline.rewind(head);
      expect((await again.timeline.events()).filter((e) => e.kind === "entity.created").length).toBe(1);
      await again.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("generation failure emits warning without aborting time advance", async () => {
    const bad: ModelPort = {
      id: "bad",
      async object(req) {
        if (req.label === "generate" || req.purpose === "entity") throw new Error("fail");
        return { type: "chat", intensity: 0.3, sincerity: 0.5, claims: [], search_terms: [], tags: [], input_class: "normal" } as never;
      },
      async *stream() {
        yield { type: "final", value: {} };
      },
    };
    const root = await mkdtemp(join(tmpdir(), "animae-anchor-fail-"));
    await seedE2eAuthored(FsStorage(root));
    await seedAnchor(root);
    await FsStorage(root).writeAtomic(
      "animae.yaml",
      `seed: 42
preset: e2e
policies: []
runtime:
  fallbackOnError:
    entity: false
`,
    );
    const engine = await createEngine({
      root,
      ports: { storage: FsStorage(root) },
      presets: [e2ePreset],
      models: { s1: bad },
      modelMode: "record",
    });
    try {
      await engine.world.advance(15);
      expect((await engine.timeline.events()).some((e) => e.kind === "config.warning" && (e as { code?: string }).code === "entity.generate_failed")).toBe(true);
      expect((await engine.timeline.events()).some((e) => e.kind === "time.advanced")).toBe(true);
    } finally {
      await engine.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("hot reload after fallback does not run entity.generate again", async () => {
    const { engine, root, storage } = await openWithAnchor({ s1: scriptedS1("Hot") });
    try {
      await engine.world.advance(15);
      expect((await engine.timeline.events()).filter((e) => e.kind === "entity.created").length).toBe(1);
      await storage.writeAtomic(
        "world/world.yaml",
        `title: E2E touched
language: en
player: player
start_location: tavern
calendar:
  sceneMinutes: 5
  turnMinutes: 1
  units: { minute: 1, hour: 60, day: 1440 }
  chapters: [{ id: ch1, days: [1, 7] }]
`,
      );
      const sceneId = await engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      for await (const _ of engine.scene.turn({ sceneId, actor: "player", text: "after reload", addressee: "npc1" })) {
        /* drain */
      }
      expect((await engine.timeline.events()).filter((e) => e.kind === "entity.created").length).toBe(1);
    } finally {
      await engine.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("record then replay yields identical event log bytes", async () => {
    const { engine, root, storage } = await openWithAnchor({ mode: "rule" });
    try {
      await engine.world.advance(15);
      const live = await storage.readText("timelines/main/events.jsonl");
      await engine.close();
      const replay = await createEngine({ root, ports: { storage }, presets: [e2ePreset], modelMode: "replay" });
      await replay.close();
      const after = await storage.readText("timelines/main/events.jsonl");
      expect(after).toBe(live);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
