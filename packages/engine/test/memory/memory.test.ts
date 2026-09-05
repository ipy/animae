import { test, expect, describe } from "bun:test";
import { createMemoryService } from "../../src/memory/service.ts";
import { createFakeKernel, charDef } from "../support/kernel-fake.ts";
import { forgettingRetention, termHitRate, recencyScore } from "../../src/memory/retrieval.ts";
import type { KnowledgeDoc } from "../../src/schema/authored.ts";
import type { RetrievalHit } from "../../src/contracts.ts";

describe("memory retrieval numerics", () => {
  test("term hit rate substring and regex", () => {
    expect(termHitRate(["hello"], "say Hello world")).toBe(1);
    expect(termHitRate(["/lo+/"], "foo")).toBe(0);
    expect(termHitRate(["/lo+/"], "hello")).toBe(1);
  });

  test("forgetting curve", () => {
    const r0 = forgettingRetention(0, 0.5, 30);
    expect(r0).toBeCloseTo(1, 5);
    const rOld = forgettingRetention(60, 0.5, 30);
    expect(rOld).toBeLessThan(0.2);
    const rHighImp = forgettingRetention(30, 0.9, 30);
    expect(rHighImp).toBeGreaterThan(forgettingRetention(30, 0.1, 30));
  });

  test("recency half-life 7 days", () => {
    expect(recencyScore({ day: 1, minute: 0 }, { day: 8, minute: 0 }, 7)).toBeCloseTo(0.5, 5);
  });
});

describe("memory service", () => {
  test("LOD extra does not persist", async () => {
    const { k } = createFakeKernel({ chars: [charDef("x", "extra")] });
    const mem = createMemoryService(k);
    const out = await mem.write("x", {
      kind: "episodic",
      t: { day: 1, minute: 0 },
      text: "t",
      tags: [],
      claims: [],
      importance: 0.5,
      valence: 0,
    });
    expect(out).toBeUndefined();
  });

  test("write list and forgetting filter", async () => {
    const { k, setState } = createFakeKernel({
      policy: { memory: { forgetting: { enabled: true, tau: 30, threshold: 0.2 } } },
    });
    const mem = createMemoryService(k);
    await mem.write("npc1", {
      kind: "episodic",
      t: { day: 1, minute: 0 },
      text: "ancient",
      tags: [],
      claims: [],
      importance: 0.1,
      valence: 0,
    });
    setState({ ...k.timeline.state(), time: { day: 100, minute: 0 } });
    const listed = await mem.list("npc1");
    expect(listed.length).toBe(0);
    const all = await mem.list("npc1", { includeForgotten: true });
    expect(all.length).toBe(1);
  });

  test("retrieve scope and scoring top K", async () => {
    const doc: KnowledgeDoc = {
      id: "world/harbor",
      name: "harbor",
      description: "fog",
      scope: "world",
      inject: "on-demand",
      tags: [],
      priority: 10,
      body: "harbor history fog",
      path: "world/knowledge/harbor.md",
      shareable: false,
    };
    const { k } = createFakeKernel({ knowledge: [doc] });
    const mem = createMemoryService(k);
    for (let i = 0; i < 10; i++) {
      await mem.write("npc1", {
        kind: "episodic",
        t: { day: 1, minute: i },
        text: i === 3 ? "unique fog lighthouse" : "noise",
        tags: [],
        claims: [],
        importance: 0.5,
        valence: 0,
      });
    }
    const hits = await mem.retrieve({
      owner: "npc1",
      terms: ["fog"],
      ctx: {},
      now: { day: 1, minute: 100 },
      limit: 3,
    });
    expect(hits.length).toBeLessThanOrEqual(3);
    expect(hits.some((h) => h.text.includes("fog"))).toBe(true);
  });

  test("knowledge always when on-demand index cap", () => {
    const docs: KnowledgeDoc[] = [];
    for (let i = 0; i < 60; i++) {
      docs.push({
        id: `world/d${i}`,
        name: `d${i}`,
        description: "",
        scope: "world",
        inject: "on-demand",
        tags: [],
        priority: i,
        body: `body ${i}`,
        path: `p${i}`,
        shareable: false,
      });
    }
    const { k } = createFakeKernel({ knowledge: docs, policy: { memory: { indexMax: 50 } } });
    const mem = createMemoryService(k);
    const inj = mem.knowledge({ owner: "npc1", ctx: {} });
    expect(inj.always.length).toBe(0);
    expect(inj.index.length).toBe(50);
    expect(inj.index[0]!.name).toBe("d59");
  });

  test("vector blending increases score", async () => {
    const { k } = createFakeKernel({
      embedding: {
        embed: async (texts) => texts.map((t) => (t.includes("alpha") ? new Float32Array([1, 0]) : new Float32Array([0, 1]))),
      },
    });
    const mem = createMemoryService(k);
    await mem.write("npc1", {
      kind: "episodic",
      t: { day: 1, minute: 0 },
      text: "alpha beta",
      tags: [],
      claims: [],
      importance: 0.5,
      valence: 0,
    });
    await mem.write("npc1", {
      kind: "episodic",
      t: { day: 1, minute: 0 },
      text: "gamma delta",
      tags: [],
      claims: [],
      importance: 0.5,
      valence: 0,
    });
    const hits = await mem.retrieve({
      owner: "npc1",
      terms: ["alpha"],
      ctx: {},
      now: { day: 1, minute: 0 },
    });
    expect(hits[0]!.text).toContain("alpha");
  });

  test("distortion deterministic", async () => {
    const { k } = createFakeKernel({
      policy: { memory: { distortion: { enabled: true, p: 1, maxImportance: 1, kinds: ["intensify"] } } },
    });
    const mem = createMemoryService(k);
    const hit: RetrievalHit = {
      kind: "memory",
      id: "m1",
      text: "x",
      score: 1,
      entry: {
        id: "m1",
        t: { day: 1, minute: 0 },
        kind: "episodic",
        text: "x",
        tags: [],
        claims: [],
        importance: 0.2,
        valence: 0,
        branch: "main",
      },
    };
    const a = await mem.distort([hit], "turn-1");
    const b = await mem.distort([hit], "turn-1");
    expect(a[0]!.distortion).toBe(b[0]!.distortion);
  });

  test("propagation hops", async () => {
    const { k, emitted } = createFakeKernel({
      policy: { memory: { propagation: { enabled: true, onTick: "day", distortionPerHop: 1 } } },
    });
    const mem = createMemoryService(k);
    await mem.write("npc1", {
      kind: "episodic",
      t: { day: 1, minute: 0 },
      text: "shared tale",
      tags: [],
      claims: [],
      importance: 0.5,
      valence: 0,
      shareable: true,
    });
    await mem.propagateTick();
    expect(emitted.some((e) => e.kind === "memory.propagated")).toBe(true);
    const playerMem = await mem.list("player");
    expect(playerMem.some((m) => m.hops === 1)).toBe(true);
  });

  test("reflection accept and reject", async () => {
    const { k, emitted, setState } = createFakeKernel({
      s2Handler: () => ({
        summaries: ["done"],
        goal_changes: [
          { action: "add", text: "ok goal", tags: [] },
          { action: "add", text: "bad", tags: ["violence"] },
        ],
        new_claims: [],
      }),
    });
    setState({
      ...k.timeline.state(),
      scene: {
        id: "scn_1",
        location: "loc",
        participants: ["npc1"],
        turn: 1,
        startedAt: { day: 1, minute: 0 },
        fields: [],
      },
    });
    const mem = createMemoryService(k);
    const res = await mem.reflect("scn_1");
    expect(res[0]!.accepted).toBe(true);
    expect(emitted.some((e) => e.kind === "reflection.accepted")).toBe(true);
    expect(emitted.some((e) => e.kind === "reflection.rejected")).toBe(true);
  });

  test("defer reflection flush", async () => {
    const { k, emitted, setState } = createFakeKernel({
      s2Handler: () => ({ summaries: [], goal_changes: [], new_claims: [] }),
    });
    setState({
      ...k.timeline.state(),
      scene: {
        id: "scn_2",
        location: "loc",
        participants: ["npc1"],
        turn: 0,
        startedAt: { day: 1, minute: 0 },
        fields: [],
      },
    });
    const mem = createMemoryService(k);
    await mem.reflect("scn_2", { defer: true });
    expect(emitted.filter((e) => e.kind === "reflection.proposed").length).toBe(0);
    await mem.flushDeferred();
    expect(emitted.some((e) => e.kind === "reflection.proposed")).toBe(true);
  });

  test("reflect with participants after scene cleared", async () => {
    const { k, emitted, setState } = createFakeKernel({
      s2Handler: () => ({ summaries: ["after end"], goal_changes: [], new_claims: [] }),
    });
    setState({
      ...k.timeline.state(),
      scene: null,
    });
    const mem = createMemoryService(k);
    await mem.reflect("scn_3", { participants: ["npc1"] });
    expect(emitted.some((e) => e.kind === "reflection.proposed")).toBe(true);
  });
});
