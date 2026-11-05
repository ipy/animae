import { describe, expect, test } from "bun:test";
import { FsStorage } from "../../src/store/fs.ts";
import { HEAD_FILE, artifactPath } from "../../src/timeline/paths.ts";
import { readEventsFile } from "../../src/timeline/event-log.ts";
import { drainTurn, openWorldEngine, worldScriptedModels } from "./world-fixture.ts";
import { e2ePreset } from "./fixture.ts";
import { playTurn, rulePreset } from "../helpers/rule-fixture.ts";

describe("world timeline e2e", () => {
  test("save load rewind branch switch diff and HEAD pointer", async () => {
    const h = await openWorldEngine({ models: worldScriptedModels() });
    try {
      const sceneId = await h.engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      await drainTurn(h.engine.scene.turn({ sceneId, actor: "player", text: "one", addressee: "npc1" }));
      const slot = await h.engine.timeline.save("mid");
      await drainTurn(h.engine.scene.turn({ sceneId, actor: "player", text: "two", addressee: "npc1" }));
      expect(h.engine.timeline.current().name).toBe("main");
      const countBefore = (await h.engine.timeline.events()).length;
      await h.engine.timeline.load(slot);
      expect((await h.engine.timeline.events()).length).toBeLessThan(countBefore);

      await drainTurn(h.engine.scene.turn({ sceneId, actor: "player", text: "fork", addressee: "npc1" }));
      const lastMain = (await h.engine.timeline.events()).at(-1)!.id;
      await h.engine.timeline.rewind(lastMain);
      const branch = h.engine.timeline.current();
      expect(branch.name).not.toBe("main");
      await h.engine.timeline.switch("main");
      await h.engine.timeline.switch(branch.name);
      const diff = await h.engine.timeline.diff("main", branch.name);
      expect(diff.events.onlyA.length + diff.events.onlyB.length).toBeGreaterThan(0);
      expect((await h.storage.readText(HEAD_FILE))?.trim()).toBe(branch.name);
      await h.engine.scene.end(sceneId);
    } finally {
      await h.dispose();
    }
  });

  test("artifacts copy-on-write across branch rewind", async () => {
    const h = await openWorldEngine();
    try {
      const memPath = artifactPath("main", "npc1/memory.jsonl");
      await h.storage.writeAtomic(memPath, `${JSON.stringify({ id: "m1", text: "before fork" })}\n`);
      const forkAt = (await h.engine.timeline.events()).at(-1)!.id;
      await h.engine.world.set("marker", 1);
      await h.engine.timeline.rewind(forkAt);
      const branchName = h.engine.timeline.current().name;
      await h.storage.writeAtomic(
        artifactPath(branchName, "npc1/memory.jsonl"),
        `${JSON.stringify({ id: "m1", text: "before fork" })}\n${JSON.stringify({ id: "m2", text: "branch only" })}\n`,
      );
      await h.engine.timeline.switch("main");
      const mainRaw = (await h.storage.readText(memPath)) ?? "";
      expect(mainRaw.includes("m2")).toBe(false);
      await h.engine.timeline.switch(branchName);
      const branchRaw = (await h.storage.readText(artifactPath(branchName, "npc1/memory.jsonl"))) ?? "";
      expect(branchRaw.includes("m2")).toBe(true);
    } finally {
      await h.dispose();
    }
  });

  test("crash-safe truncated events.jsonl tail is repaired on reopen", async () => {
    const h = await openWorldEngine();
    try {
      await h.engine.world.set("crash.safe", 1);
      const path = "timelines/main/events.jsonl";
      const raw = (await h.storage.readText(path)) ?? "";
      await h.storage.writeAtomic(path, `${raw}\n{"broken":\n`);
      await h.engine.close();
      const reopened = await h.reopen();
      expect((await reopened.timeline.events()).some((e) => (e as { path?: string }).path === "crash.safe")).toBe(true);
      await reopened.close();
    } finally {
      await h.dispose();
    }
  });

  test("purge redacts utterances, removes artifacts, purge.applied, reload equivalence", async () => {
    const preset = rulePreset();
    const h = await openWorldEngine({ preset, mode: "rule" });
    try {
      const sceneId = await h.engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      await playTurn(h.engine, sceneId, "purge me");
      await h.storage.writeAtomic(
        artifactPath("main", "npc1/memory.jsonl"),
        `${JSON.stringify({ id: "mem1", text: "secret" })}\n`,
      );
      await h.engine.purge({ characters: ["npc1"] });
      const utterances = (await readEventsFile(FsStorage(h.root), "main")).events.filter((e) => e.kind === "utterance");
      const ariaLines = utterances.filter((e) => (e as { speaker?: string }).speaker === "npc1");
      expect(ariaLines.every((e) => (e as { text?: string }).text === "[redacted]")).toBe(true);
      expect(await FsStorage(h.root).exists(artifactPath("main", "npc1/memory.jsonl"))).toBe(false);
      const applied = (await h.engine.timeline.events({ kinds: ["purge.applied"] }))[0] as {
        eventIds?: string[];
        scope?: { characters?: string[] };
      };
      expect(applied?.scope?.characters).toEqual(["npc1"]);
      expect(applied?.eventIds?.length).toBeGreaterThan(0);

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

  test("lock file is written while engine holds the storage root", async () => {
    const h = await openWorldEngine();
    try {
      expect(await h.storage.readText(".animae.lock")).toBe(String(process.pid));
    } finally {
      await h.dispose();
    }
  });
});
