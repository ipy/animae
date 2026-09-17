import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "../../src/engine/create-engine.ts";
import { createMutationGate } from "../../src/engine/mutation-gate.ts";
import { FsStorage } from "../../src/store/fs.ts";
import { createScriptedModel } from "../../src/model/scripted.ts";
import { e2ePreset, seedE2eAuthored } from "../e2e/fixture.ts";

const models = {
  s1: createScriptedModel("gate/s1", () => ({ text: "hi", cues: [], intent_realized: "talk" })),
  s2: createScriptedModel("gate/s2", () => ({ type: "chat", intensity: 0.5, sincerity: 0.9, claims: [], search_terms: [], tags: [], input_class: "normal" })),
};

/** Resolve to "timeout" when `p` does not settle within `ms` (a wedged gate never settles). */
async function settlesWithin<T>(p: Promise<T>, ms = 500): Promise<T | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

describe("mutation gate accounting", () => {
  test("nested withLock calls do not deadlock", async () => {
    const gate = createMutationGate();
    const order: string[] = [];
    const result = await settlesWithin(
      gate.withLock(async () => {
        order.push("outer:start");
        await gate.withLock(async () => {
          order.push("inner");
        });
        order.push("outer:end");
        return "ok";
      }),
    );
    expect(result).toBe("ok");
    expect(order).toEqual(["outer:start", "inner", "outer:end"]);
    expect(gate.busy()).toBe(false);
  });

  test("overlapping holders that release out of order leave the gate usable", async () => {
    const gate = createMutationGate();
    const releaseA = await gate.acquire();
    const releaseB = await gate.acquire(); // joins while A is held
    expect(gate.busy()).toBe(true);
    releaseA(); // outer holder leaves first: B still holds the gate
    expect(gate.busy()).toBe(true);
    releaseB();
    expect(gate.busy()).toBe(false);

    const next = gate.withLock(async () => "next");
    expect(await settlesWithin(next)).toBe("next");
    await expect(settlesWithin(gate.drain())).resolves.toBeUndefined();
  });

  test("concurrent unrelated flows never wedge later callers", async () => {
    const gate = createMutationGate();
    const slow = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    await Promise.all([
      gate.withLock(() => slow(15)),
      gate.withLock(() => slow(5)),
      gate.withLock(() => slow(1)),
      (async () => {
        await slow(2);
        await gate.withLock(() => slow(10));
      })(),
    ]);
    expect(gate.busy()).toBe(false);
    expect(await settlesWithin(gate.withLock(async () => "after"))).toBe("after");
  });

  test("callers queued behind an idle acquire run strictly one group at a time", async () => {
    const gate = createMutationGate();
    const trace: string[] = [];
    const run = (name: string, ms: number) =>
      gate.withLock(async () => {
        trace.push(`${name}:in`);
        await new Promise<void>((r) => setTimeout(r, ms));
        trace.push(`${name}:out`);
      });
    await Promise.all([run("a", 10), run("b", 1), run("c", 1)]);
    expect(trace).toEqual(["a:in", "a:out", "b:in", "b:out", "c:in", "c:out"]);
  });

  test("releasing twice does not corrupt the holder count", async () => {
    const gate = createMutationGate();
    const releaseA = await gate.acquire();
    const releaseB = await gate.acquire();
    releaseA();
    releaseA(); // duplicate: must not drop B's hold
    expect(gate.busy()).toBe(true);
    releaseB();
    expect(gate.busy()).toBe(false);
    expect(await settlesWithin(gate.withLock(async () => 1))).toBe(1);
  });

  test("a failing critical section still releases the gate", async () => {
    const gate = createMutationGate();
    await expect(
      gate.withLock(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(gate.busy()).toBe(false);
    expect(await settlesWithin(gate.withLock(async () => "fine"))).toBe("fine");
  });
});

test("parallel scene.turn calls serialize", async () => {
  const root = await mkdtemp(join(tmpdir(), "animae-gate-"));
  try {
    await seedE2eAuthored(FsStorage(root));
    const engine = await createEngine({ root, presets: [e2ePreset], models, sessionId: "gate_sess" });
    const sceneId = await engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
    const t1 = engine.scene.turn({ sceneId, actor: "player", text: "one", addressee: "npc1" });
    const t2 = engine.scene.turn({ sceneId, actor: "player", text: "two", addressee: "npc1" });
    const run = async (it: AsyncIterable<{ type: string }>) => {
      for await (const _ of it) {
        /* drain */
      }
    };
    await Promise.all([run(t1), run(t2)]);
    await engine.scene.end(sceneId);
    await engine.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("close awaits in-flight turn append queue", async () => {
  const root = await mkdtemp(join(tmpdir(), "animae-gate-close-"));
  try {
    await seedE2eAuthored(FsStorage(root));
    const engine = await createEngine({ root, presets: [e2ePreset], models, sessionId: "gate_close" });
    const sceneId = await engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
    const iter = engine.scene.turn({ sceneId, actor: "player", text: "stream", addressee: "npc1" });
    const closeP = engine.close();
    for await (const _ of iter) {
      /* consume while closing */
    }
    await closeP;
    const reopen = await createEngine({ root, presets: [e2ePreset], models, sessionId: "gate_reopen" });
    const ev = await reopen.timeline.events({ kinds: ["input.received"] });
    expect(ev.length).toBeGreaterThan(0);
    await reopen.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("double close is safe and lock can reopen", async () => {
  const root = await mkdtemp(join(tmpdir(), "animae-gate-double-close-"));
  try {
    await seedE2eAuthored(FsStorage(root));
    const engine = await createEngine({ root, presets: [e2ePreset], models, sessionId: "gate_double" });
    await engine.close();
    await engine.close();
    const again = await createEngine({ root, presets: [e2ePreset], models, sessionId: "gate_double2" });
    await again.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
