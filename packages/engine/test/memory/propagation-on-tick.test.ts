import { describe, expect, test } from "bun:test";
import { createMemoryService } from "../../src/memory/service.ts";
import { createWorldService } from "../../src/world/service.ts";
import { createIntrospect } from "../../src/introspect/service.ts";
import { createFakeKernel } from "../support/kernel-fake.ts";

async function seedShareable(mem: ReturnType<typeof createMemoryService>) {
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
}

describe("propagation onTick", () => {
  test("onTick day ignores scene_end tick and runs on day tick", async () => {
    const { k, emitted } = createFakeKernel({
      policy: { memory: { propagation: { enabled: true, onTick: "day", distortionPerHop: 1 } } },
    });
    const mem = createMemoryService(k);
    await seedShareable(mem);
    await mem.propagateTick("scene_end");
    expect(emitted.filter((e) => e.kind === "memory.propagated")).toHaveLength(0);
    await mem.propagateTick("day");
    expect(emitted.some((e) => e.kind === "memory.propagated")).toBe(true);
  });

  test("onTick scene_end propagates only at scene end", async () => {
    const { k, emitted } = createFakeKernel({
      policy: { memory: { propagation: { enabled: true, onTick: "scene_end", distortionPerHop: 1 } } },
    });
    const mem = createMemoryService(k);
    await seedShareable(mem);
    await mem.propagateTick("day");
    expect(emitted.filter((e) => e.kind === "memory.propagated")).toHaveLength(0);
    await mem.propagateTick("scene_end");
    expect(emitted.some((e) => e.kind === "memory.propagated")).toBe(true);
  });

  test("disabled propagation is a no-op for any when", async () => {
    const { k, emitted } = createFakeKernel({
      policy: { memory: { propagation: { enabled: false, onTick: "day", distortionPerHop: 1 } } },
    });
    const mem = createMemoryService(k);
    await seedShareable(mem);
    await mem.propagateTick("day");
    await mem.propagateTick("scene_end");
    expect(emitted.filter((e) => e.kind === "memory.propagated")).toHaveLength(0);
  });

  test("world.advance across a day boundary propagates when onTick is day", async () => {
    const { k, emitted } = createFakeKernel({
      policy: { memory: { propagation: { enabled: true, onTick: "day", distortionPerHop: 1 } } },
    });
    k.m.memory = createMemoryService(k);
    k.m.introspect = createIntrospect(k);
    k.m.world = createWorldService(k);
    await seedShareable(k.m.memory);
    await k.m.world.advance({ to: { day: 2, minute: 0 } });
    expect(emitted.filter((e) => e.kind === "memory.propagated").length).toBe(1);
    await k.m.world.advance({ to: { day: 4, minute: 0 } });
    expect(emitted.filter((e) => e.kind === "memory.propagated").length).toBe(1);
  });

  test("carriedFrom dedup prevents second propagation to same target", async () => {
    const { k, emitted } = createFakeKernel({
      policy: { memory: { propagation: { enabled: true, onTick: "day", distortionPerHop: 1 } } },
    });
    const mem = createMemoryService(k);
    await seedShareable(mem);
    await mem.propagateTick("day");
    expect(emitted.filter((e) => e.kind === "memory.propagated")).toHaveLength(1);
    await mem.propagateTick("day");
    expect(emitted.filter((e) => e.kind === "memory.propagated")).toHaveLength(1);
  });
});
