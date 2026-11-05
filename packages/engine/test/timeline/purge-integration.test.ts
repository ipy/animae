import { expect, test } from "bun:test";
import { FsStorage } from "../../src/store/fs.ts";
import { eventsOf, openRuleEngine, playTurn, startScene } from "../helpers/rule-fixture.ts";
import { readEventsFile } from "../../src/timeline/event-log.ts";
import { artifactPath } from "../../src/timeline/paths.ts";

test("Engine.purge through createEngine redacts live utterances and persists", async () => {
  const h = await openRuleEngine();
  try {
    const sceneId = await startScene(h.engine);
    await playTurn(h.engine, sceneId, "hello there");
    const storage = FsStorage(h.root);
    const before = (await readEventsFile(storage, "main")).events.filter((e) => e.kind === "utterance");
    expect(before.some((e) => (e as { text?: string }).text && (e as { text?: string }).text !== "[redacted]")).toBe(true);

    await storage.writeAtomic("timelines/main/artifacts/npc1/memory.jsonl", '{"id":"m1","text":"mem"}\n');
    await h.engine.purge({ characters: ["npc1"] });

    const all = (await readEventsFile(storage, "main")).events;
    const npcLines = all.filter((e) => e.kind === "utterance" && (e as { speaker?: string }).speaker === "npc1");
    expect(npcLines.every((e) => (e as { text?: string }).text === "[redacted]")).toBe(true);
    expect(all.some((e) => e.kind === "purge.applied")).toBe(true);
    expect(await storage.exists(artifactPath("main", "npc1/memory.jsonl"))).toBe(false);

    const reopened = await h.reopen();
    const again = (await readEventsFile(FsStorage(h.root), "main")).events.filter(
      (e) => e.kind === "utterance" && (e as { speaker?: string }).speaker === "npc1",
    );
    expect(again.every((e) => (e as { text?: string }).text === "[redacted]")).toBe(true);
    await reopened.close();
  } finally {
    await h.dispose();
  }
});

test("purge.applied lists redacted event ids with scope", async () => {
  const h = await openRuleEngine();
  try {
    const sceneId = await startScene(h.engine);
    await playTurn(h.engine, sceneId, "thanks");
    await h.engine.purge({ characters: ["npc1"] });
    const applied = (await eventsOf(h.engine, "purge.applied"))[0];
    expect(applied).toBeDefined();
    const ids = (applied as { eventIds?: string[] }).eventIds ?? [];
    expect(ids.length).toBeGreaterThan(0);
    expect((applied as { scope?: { characters?: string[] } }).scope?.characters).toEqual(["npc1"]);
    const reopened = await h.reopen();
    const purged = (await eventsOf(reopened, "purge.applied")).flatMap(
      (e) => (e as { eventIds?: string[] }).eventIds ?? [],
    );
    expect(purged).toEqual(expect.arrayContaining(ids));
    await reopened.close();
  } finally {
    await h.dispose();
  }
});
