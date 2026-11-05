import { describe, expect, test } from "bun:test";
import { createMemoryService } from "../../src/memory/service.ts";
import { createFakeKernel } from "../support/kernel-fake.ts";
import type { RetrievalHit } from "../../src/contracts.ts";

const baseEntry = {
  id: "m1",
  t: { day: 1, minute: 0 },
  kind: "episodic" as const,
  text: "x",
  tags: [] as string[],
  claims: [] as { s: string; p: string; o: string }[],
  importance: 0.2,
  valence: 0,
  branch: "main",
};

describe("memory distortion", () => {
  test("memory.distorted event includes owner", async () => {
    const { k, emitted } = createFakeKernel({
      policy: { memory: { distortion: { enabled: true, p: 1, maxImportance: 1, kinds: ["intensify"] } } },
    });
    const mem = createMemoryService(k);
    const hit: RetrievalHit = {
      kind: "memory",
      id: "m1",
      text: "x",
      score: 1,
      owner: "npc1",
      entry: baseEntry,
    };
    await mem.distort([hit], "turn-owner");
    const ev = emitted.find((e) => e.kind === "memory.distorted") as { owner?: string; memoryId?: string } | undefined;
    expect(ev?.owner).toBe("npc1");
    expect(ev?.memoryId).toBe("m1");
  });

  test("p_eff = min(1, p + hops * distortionPerHop * 0.05) is deterministic", async () => {
    const { k } = createFakeKernel({
      policy: {
        memory: {
          distortion: { enabled: true, p: 0, maxImportance: 1, kinds: ["intensify"] },
          propagation: { enabled: false, onTick: "day", distortionPerHop: 1 },
        },
      },
    });
    const mem = createMemoryService(k);
    const noHop: RetrievalHit = {
      kind: "memory",
      id: "a",
      text: "a",
      score: 1,
      owner: "npc1",
      entry: { ...baseEntry, id: "a", hops: 0 },
    };
    const highHop: RetrievalHit = {
      kind: "memory",
      id: "b",
      text: "b",
      score: 1,
      owner: "npc1",
      entry: { ...baseEntry, id: "b", hops: 20 },
    };
    const a = await mem.distort([noHop], "hop-pin");
    const b = await mem.distort([highHop], "hop-pin");
    expect(a[0]!.distortion).toBeUndefined();
    expect(b[0]!.distortion).toBeDefined();
    const again = await mem.distort([highHop], "hop-pin");
    expect(again[0]!.distortion).toBe(b[0]!.distortion);
  });
});
