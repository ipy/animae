import { describe, expect, test } from "bun:test";
import { MemoryStorage } from "../../src/store/memory.ts";
import { createTimeline } from "../../src/timeline/timeline-store.ts";
import { readEventsFile } from "../../src/timeline/event-log.ts";
import { rebuildState } from "../../src/timeline/snapshots.ts";
import { reduce } from "../../src/timeline/reducer.ts";
import { initialState } from "../../src/timeline/initial-state.ts";
import { artifactPath } from "../../src/timeline/paths.ts";
import { purgeEventsAndArtifacts } from "../../src/timeline/purge.ts";
import { fakeCel, minimalAuthored, minimalPolicy } from "./fixture.ts";
import { purgeEventBase } from "./purge-fixture.ts";

function makeTimeline(storage = MemoryStorage()) {
  return createTimeline({
    storage,
    authored: () => minimalAuthored(),
    policy: () => minimalPolicy(),
    cel: fakeCel,
    seed: 42,
    sessionId: "sess-main",
    modelMode: "live",
  });
}

describe("timeline purge (spec 13)", () => {
  test("scoped character purge deletes artifacts, redacts log text, emits purge.applied", async () => {
    const storage = MemoryStorage();
    const tl = makeTimeline(storage);
    await tl.open();
    await tl.artifacts.appendJsonl("npc1/memory.jsonl", { id: "m1", text: "secret memory" });
    await tl.artifacts.writeText("npc1/summaries/day1.md", "summary body");
    await tl.artifacts.writeText("player/memory.jsonl", "other");
    await tl.append([
      { kind: "utterance", speaker: "npc1", text: "private line", cues: [] },
      { kind: "utterance", speaker: "player", text: "keep me", cues: [] },
      {
        kind: "memory.written",
        owner: "npc1",
        memoryId: "mem_1",
        text: "written",
        importance: 0.5,
        tags: [],
      },
      {
        kind: "reflection.accepted",
        owner: "npc1",
        summaries: ["reflect"],
        goal_changes: [],
        new_claims: [{ text: "claim", tags: [] }],
      },
    ]);
    const beforeIds = tl.events().map((e) => e.id);
    await tl.purge({ characters: ["npc1"] });

    expect(await storage.exists(artifactPath("main", "npc1/memory.jsonl"))).toBe(false);
    expect(await storage.exists(artifactPath("main", "npc1/summaries/day1.md"))).toBe(false);
    expect(await storage.exists(artifactPath("main", "player/memory.jsonl"))).toBe(true);

    const applied = tl.events().find((e) => e.kind === "purge.applied");
    expect(applied).toBeDefined();
    const redacted = (applied as { eventIds?: string[]; scope?: unknown }).eventIds ?? [];
    expect(redacted.length).toBe(3);
    expect((applied as { scope?: { characters?: string[] } }).scope).toEqual({ characters: ["npc1"] });

    const utterNpc = tl.events().find((e) => e.kind === "utterance" && (e as { speaker?: string }).speaker === "npc1");
    const utterPlayer = tl.events().find((e) => e.kind === "utterance" && (e as { speaker?: string }).speaker === "player");
    expect((utterNpc as { text?: string }).text).toBe("[redacted]");
    expect((utterPlayer as { text?: string }).text).toBe("keep me");

    const mem = tl.events().find((e) => e.kind === "memory.written");
    expect((mem as { text?: string }).text).toBe("[redacted]");
    const refl = tl.events().find((e) => e.kind === "reflection.accepted");
    expect((refl as { summaries?: string[] }).summaries).toEqual(["[redacted]"]);
    expect((refl as { new_claims?: unknown[] }).new_claims).toEqual([]);

    expect(tl.state().purged.sort()).toEqual([...redacted].sort());

    await tl.close();
    const tl2 = makeTimeline(storage);
    await tl2.open();
    const reloaded = tl2.events().find((e) => beforeIds.includes(e.id) && e.kind === "utterance" && (e as { speaker?: string }).speaker === "npc1");
    expect((reloaded as { text?: string }).text).toBe("[redacted]");
    expect(tl2.state().purged.sort()).toEqual([...redacted].sort());
  });

  test("session scope skips redaction for other sessions", async () => {
    const storage = MemoryStorage();
    const tl = makeTimeline(storage);
    await tl.open();
    const base = purgeEventBase("sess-a");
    await tl.append([
      { kind: "utterance", speaker: "npc1", text: "sess-a line", cues: [], ...base },
    ]);
    const { events } = await readEventsFile(storage, "main");
    const patched = events.map((e) =>
      e.kind === "utterance" ? e : e,
    );
    const other: typeof events[number] = {
      id: "evt_0099",
      kind: "utterance",
      speaker: "npc1",
      text: "other session",
      cues: [],
      ...purgeEventBase("sess-other"),
    };
    const header = (await readEventsFile(storage, "main")).header;
    await storage.writeAtomic(
      "timelines/main/events.jsonl",
      `${JSON.stringify(header)}\n${[...patched, other].map((e) => JSON.stringify(e)).join("\n")}\n`,
    );
    await tl.close();
    const tl2 = makeTimeline(storage);
    await tl2.open();
    await tl2.purge({ characters: ["npc1"], sessions: ["sess-a"] });
    const lines = tl2.events().filter((e) => e.kind === "utterance" && (e as { speaker?: string }).speaker === "npc1");
    const a = lines.find((e) => e.sid === "sess-a");
    const o = lines.find((e) => e.sid === "sess-other");
    expect((a as { text?: string }).text).toBe("[redacted]");
    expect((o as { text?: string }).text).toBe("other session");
  });

  test("memoryIds scope removes matching artifact files", async () => {
    const storage = MemoryStorage();
    const tl = makeTimeline(storage);
    await tl.open();
    await tl.artifacts.writeText("mem_abc.md", "doc");
    await tl.artifacts.writeText("npc1/mem_abc/slot.md", "nested");
    await tl.purge({ memoryIds: ["mem_abc"] });
    const listed = await storage.listFiles("timelines/main/artifacts");
    expect(listed.some((f) => f.includes("mem_abc"))).toBe(false);
  });

  test("purge across branch chain removes inherited artifacts", async () => {
    const storage = MemoryStorage();
    const tl = makeTimeline(storage);
    await tl.open();
    await tl.append([{ kind: "world.var_set", path: "marker", value: 0 }]);
    await tl.artifacts.appendJsonl("npc1/memory.jsonl", { id: "m0", text: "root" });
    const forkAt = tl.events().at(-1)!.id;
    await tl.append([{ kind: "world.var_set", path: "fork", value: 1 }]);
    await tl.rewind(forkAt);
    await tl.artifacts.appendJsonl("npc1/memory.jsonl", { id: "m1", text: "fork" });
    await tl.purge({ characters: ["npc1"] });
    expect(await storage.exists(artifactPath(tl.branch().name, "npc1/memory.jsonl"))).toBe(false);
    const mainTl = makeTimeline(storage);
    await mainTl.open();
    await mainTl.switch("main");
    expect(await storage.exists(artifactPath("main", "npc1/memory.jsonl"))).toBe(false);
  });

  test("reducer replay after purge keeps purged id list", async () => {
    const authored = minimalAuthored();
    const policy = minimalPolicy();
    let s = initialState(authored, policy);
    const e1 = {
      id: "evt_0001",
      kind: "utterance" as const,
      speaker: "npc1",
      text: "x",
      cues: [],
      ...purgeEventBase(),
    };
    s = reduce(s, e1, policy);
    s = reduce(
      s,
      {
        id: "evt_0002",
        kind: "purge.applied",
        eventIds: ["evt_0001"],
        scope: { characters: ["npc1"] },
        ...purgeEventBase(),
      },
      policy,
    );
    expect(s.purged).toEqual(["evt_0001"]);
    const replayed = await rebuildState(authored, policy, [e1, { id: "evt_0002", kind: "purge.applied", eventIds: ["evt_0001"], scope: { characters: ["npc1"] }, ...purgeEventBase() }]);
    expect(replayed.purged).toEqual(["evt_0001"]);
  });

  test("second purge is idempotent on already redacted events", async () => {
    const storage = MemoryStorage();
    const tl = makeTimeline(storage);
    await tl.open();
    await tl.append([{ kind: "utterance", speaker: "npc1", text: "once", cues: [] }]);
    await tl.purge({ characters: ["npc1"] });
    const firstApplied = tl.events().filter((e) => e.kind === "purge.applied").length;
    await tl.purge({ characters: ["npc1"] });
    const secondApplied = tl.events().filter((e) => e.kind === "purge.applied").length;
    expect(secondApplied).toBe(firstApplied + 1);
    const u = tl.events().find((e) => e.kind === "utterance");
    expect((u as { text?: string }).text).toBe("[redacted]");
  });

  test("empty character set redacts all utterances and owner-less memory events", async () => {
    const storage = MemoryStorage();
    const authored = minimalAuthored();
    const policy = minimalPolicy();
    const deps = {
      storage,
      authored: () => authored,
      policy: () => policy,
      cel: fakeCel,
      seed: 42,
      sessionId: "purge-empty-scope",
      modelMode: "live" as const,
    };
    const header = { kind: "branch.header" as const, branch: "main" };
    const evs = [
      {
        id: "evt_0001",
        kind: "utterance" as const,
        speaker: "npc1",
        text: "a",
        cues: [],
        ...purgeEventBase(),
      },
      {
        id: "evt_0002",
        kind: "memory.written" as const,
        owner: "npc1",
        memoryId: "m",
        text: "b",
        importance: 1,
        tags: [],
        ...purgeEventBase(),
      },
    ];
    await storage.writeAtomic(
      "timelines/main/events.jsonl",
      `${JSON.stringify(header)}\n${evs.map((e) => JSON.stringify(e)).join("\n")}\n`,
    );
    const appended: unknown[] = [];
    await purgeEventsAndArtifacts(deps, {
      branch: "main",
      chain: [{ name: "main" }],
      state: initialState(authored, policy),
      events: evs,
      scope: { characters: [] },
      append: async (drafts) => {
        appended.push(...drafts);
        return [];
      },
    });
    const { events } = await readEventsFile(storage, "main");
    expect(events.every((e) => e.kind !== "utterance" || (e as { text?: string }).text === "[redacted]")).toBe(true);
    expect(appended).toHaveLength(1);
    expect((appended[0] as { kind?: string }).kind).toBe("purge.applied");
  });
});
