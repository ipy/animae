import { describe, expect, test } from "bun:test";
import { createMemoryService } from "../../src/memory/service.ts";
import { writeTurnMemory, writeNarrationMemory } from "../../src/memory/writing.ts";
import { createFakeKernel } from "../support/kernel-fake.ts";
import { testAppraisal } from "../helpers/memory-policy.ts";
import { testTurnCtx } from "../helpers/turn-context.ts";
import { AnimaeError } from "../../src/types.ts";

describe("writeTurnMemory", () => {
  test("skips when episodic off or below min intensity", async () => {
    const { k } = createFakeKernel();
    const write = k.policy.memory.write!;
    write.episodic = false;
    write.minIntensity = 0;
    k.m.memory = createMemoryService(k);
    const writes: unknown[] = [];
    const orig = k.m.memory.write.bind(k.m.memory);
    k.m.memory.write = async (...args) => {
      writes.push(args);
      return orig(...args);
    };
    await writeTurnMemory(k, testTurnCtx({ text: "hi" }), {
      speaker: "npc1",
      addressee: "player",
      actor: "player",
      appraisal: testAppraisal({ type: "chat", intensity: 0.9 }),
      text: "hello",
      moodDelta: 0.1,
      backend: "rule",
    });
    expect(writes).toEqual([]);
  });

  test("rule backend writes episodic memory from structured rule output", async () => {
    const { k } = createFakeKernel();
    const write = k.policy.memory.write!;
    write.episodic = true;
    write.minIntensity = 0.1;
    write.maxChars = 100;
    k.m.memory = createMemoryService(k);
    await writeTurnMemory(k, testTurnCtx({ text: "input" }), {
      speaker: "npc1",
      addressee: "player",
      actor: "player",
      appraisal: testAppraisal({ type: "chat", intensity: 0.5, tags: ["talk"] }),
      text: "We spoke.",
      moodDelta: 0.2,
      backend: "rule",
    });
    const listed = await k.m.memory.list("npc1");
    expect(listed.length).toBe(1);
    expect(listed[0]!.text.length).toBeLessThanOrEqual(100);
    expect(listed[0]!.tags).toContain("talk");
  });

  test("s1 backend uses model output when configured", async () => {
    const { k } = createFakeKernel({
      s1Handler: () => ({ text: "Model summary.", importance: 0.8, valence: 0.3 }),
    });
    k.policy.memory.writing!.backend = "s1";
    k.m.memory = createMemoryService(k);
    await writeTurnMemory(k, testTurnCtx({ text: "in", outputLocale: "en" }), {
      speaker: "npc1",
      addressee: "player",
      actor: "player",
      appraisal: testAppraisal({ type: "chat", intensity: 0.5 }),
      text: "reply",
      moodDelta: 0,
      backend: "llm",
    });
    const listed = await k.m.memory.list("npc1");
    expect(listed[0]?.text).toBe("Model summary.");
    expect(listed[0]?.importance).toBeCloseTo(0.8, 5);
  });

  test("model failure propagates classified model errors without rule fallback", async () => {
    const { k } = createFakeKernel({
      s1Handler: () => {
        throw new AnimaeError("MODEL_HTTP", "upstream failed");
      },
    });
    k.policy.memory.writing!.backend = "s1";
    k.m.memory = createMemoryService(k);
    await expect(
      writeTurnMemory(k, testTurnCtx({ text: "in" }), {
        speaker: "npc1",
        addressee: "player",
        actor: "player",
        appraisal: testAppraisal({ type: "chat", intensity: 0.5 }),
        text: "reply",
        moodDelta: 0,
        backend: "llm",
      }),
    ).rejects.toMatchObject({ code: "MODEL_HTTP" });
  });
});

describe("writeNarrationMemory", () => {
  test("inject_belief writes semantic memory for non-player witnesses", async () => {
    const { k, setState } = createFakeKernel();
    const writing = k.policy.memory.writing!;
    writing.narration = "inject_belief";
    writing.importanceByEventType.narration = 0.5;
    k.policy.memory.write!.maxChars = 200;
    k.m.memory = createMemoryService(k);
    setState({
      ...k.timeline.state(),
      scene: {
        id: "scn_1",
        location: "loc",
        participants: ["player", "npc1"],
        turn: 1,
        startedAt: { day: 1, minute: 0 },
        fields: [],
      },
    });
    await writeNarrationMemory(
      k,
      [{ id: "evt_1", text: "The door creaks.", style: "normal" }],
      { sceneId: "scn_1" },
    );
    const npcMem = await k.m.memory.list("npc1");
    expect(npcMem.some((m) => m.kind === "semantic" && m.text.includes("door"))).toBe(true);
    const playerMem = await k.m.memory.list("player");
    expect(playerMem.length).toBe(0);
  });

  test("shareable mode tags episodic entries and skips scene breaks", async () => {
    const { k, setState } = createFakeKernel();
    k.policy.memory.writing!.narration = "shareable";
    k.policy.memory.write!.maxChars = 200;
    k.m.memory = createMemoryService(k);
    setState({
      ...k.timeline.state(),
      scene: {
        id: "scn_1",
        location: "loc",
        participants: ["player", "npc1"],
        turn: 1,
        startedAt: { day: 1, minute: 0 },
        fields: [],
      },
    });
    await writeNarrationMemory(
      k,
      [
        { id: "evt_1", text: "Shared tale.", style: "normal" },
        { id: "evt_2", text: "---", style: "scene_break" },
      ],
      { sceneId: "scn_1" },
    );
    const listed = await k.m.memory.list("npc1");
    expect(listed.length).toBe(1);
    expect(listed[0]?.shareable).toBe(true);
    expect(listed[0]?.tags).toContain("shareable");
  });
});
