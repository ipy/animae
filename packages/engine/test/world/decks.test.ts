import { test, expect, describe } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "../../src/engine/create-engine.ts";
import { FsStorage } from "../../src/store/fs.ts";
import { createScriptedModel } from "../../src/model/scripted.ts";
import { e2ePreset, seedE2eAuthored } from "../e2e/fixture.ts";

const models = {
  s1: createScriptedModel("deck/s1", () => ({ text: "ok", cues: [], intent_realized: "talk" })),
  s2: createScriptedModel("deck/s2", () => ({
    type: "chat",
    intensity: 0.5,
    sincerity: 0.9,
    claims: [],
    search_terms: [],
    tags: [],
    input_class: "normal",
  })),
};

describe("event decks", () => {
  test("day draw is deterministic for fixed seed", async () => {
    const root = await mkdtemp(join(tmpdir(), "animae-deck-"));
    try {
      const storage = FsStorage(root);
      await seedE2eAuthored(storage);
      await storage.writeAtomic(
        "world/decks/daily.yaml",
        `id: daily
drawOn: day
maxPerDay: 1
entries:
  - id: a
    weight: 1
    emit:
      kind: world.var_set
      path: deck.last
      value: a
  - id: b
    weight: 3
    emit:
      kind: world.var_set
      path: deck.last
      value: b
`,
      );
      const run = async () => {
        const engine = await createEngine({ root, presets: [e2ePreset], models, seed: 77, sessionId: "deck" });
        try {
          await engine.world.advance({ to: { day: 2, minute: 480 } });
          const draws = (await engine.timeline.events({ kinds: ["deck.drawn"] })).map((e) => (e as { entryId?: string }).entryId);
          return draws;
        } finally {
          await engine.close();
        }
      };
      const a = await run();
      const b = await run();
      expect(a).toEqual(b);
      expect(a.length).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
