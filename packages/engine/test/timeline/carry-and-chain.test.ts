import { describe, expect, test } from "bun:test";
import { collectCarry, buildChainRefs } from "../../src/timeline/carry.ts";
import { MemoryStorage } from "../../src/store/memory.ts";
import { minimalPolicy, fakeCel } from "./fixture.ts";
import { initialState } from "../../src/timeline/initial-state.ts";
import { minimalAuthored } from "./fixture.ts";
import { artifactPath } from "../../src/timeline/paths.ts";
import { memoryJsonlPath } from "../../src/memory/util.ts";
import type { EngineEvent } from "../../src/types.ts";

describe("buildChainRefs", () => {
  test("walks parent pointers into root-first chain", () => {
    const chain = buildChainRefs(
      [
        { branch: "main" },
        { branch: "fork", parent: "main", forkAt: "evt_0005" },
        { branch: "tip", parent: "fork", forkAt: "evt_0010" },
      ],
      "tip",
    );
    expect(chain.map((b) => b.name)).toEqual(["main", "fork", "tip"]);
    expect(chain[1]?.forkAt).toBe("evt_0005");
  });
});

describe("collectCarry", () => {
  test("empty carry rules emit carry.applied with no items", async () => {
    const policy = minimalPolicy({ timeline: { allowRewind: true, carry: [] } });
    const authored = minimalAuthored();
    const state = initialState(authored, policy);
    const result = await collectCarry(MemoryStorage(), policy, fakeCel, "main", "evt_0001", [], state);
    expect(result.drafts).toEqual([{ kind: "carry.applied", items: [] }]);
    expect(result.artifactLines).toEqual([]);
  });

  test("carries world vars, tracks, and memory after fork", async () => {
    const policy = minimalPolicy({
      timeline: {
        allowRewind: true,
        carry: [{ characters: ["npc1"], kinds: ["world_var", "track", "memory"], tags: ["talk"], when: "true" }],
      },
    });
    const authored = minimalAuthored();
    let state = initialState(authored, policy);
    const storage = MemoryStorage("carry-test");
    const events: EngineEvent[] = [
      { id: "evt_0002", kind: "world.var_set", path: "flag", value: 1, t: state.time, sid: "s", source: "t", because: [] },
      {
        id: "evt_0003",
        kind: "track.delta",
        owner: "npc1",
        track: "mood",
        delta: 5,
        before: 50,
        after: 55,
        t: state.time,
        sid: "s",
        source: "t",
        because: [],
      },
      {
        id: "evt_0004",
        kind: "memory.written",
        owner: "npc1",
        memoryId: "mem_1",
        importance: 0.5,
        path: memoryJsonlPath("npc1"),
        t: state.time,
        sid: "s",
        source: "t",
        because: [],
      },
    ];
    const memLine = JSON.stringify({
      id: "mem_1",
      kind: "episodic",
      text: "spoken",
      tags: ["talk"],
      importance: 0.5,
      valence: 0,
      _seq: 4,
    });
    await storage.writeAtomic(artifactPath("main", memoryJsonlPath("npc1")), `${memLine}\n`);

    const result = await collectCarry(storage, policy, fakeCel, "main", "evt_0001", events, state);
    const kinds = result.drafts.map((d) => d.kind);
    expect(kinds).toContain("world.var_set");
    expect(kinds).toContain("track.delta");
    expect(kinds).toContain("memory.written");
    expect(result.artifactLines.length).toBe(1);
    expect(result.drafts.find((d) => d.kind === "track.delta")?.reason).toBe("carry");
  });
});
