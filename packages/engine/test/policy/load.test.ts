import { test, expect } from "bun:test";
import { loadPolicy } from "../../src/policy/load.ts";
import { createPresetRegistry } from "../../src/policy/registry.ts";
import { MemoryStorage } from "../../src/store/memory.ts";
import { AnimaeError } from "../../src/types.ts";

const basePolicy = `
events:
  types:
    care: { positive: true }
tracks:
  affinity:
    min: 0
    max: 100
    initial: 50
    tiers:
      - { name: distant, from: 0 }
      - { name: close, from: 60 }
rules:
  delta_table:
    care:
      affinity: 4
intent:
  types: [respond]
`;

test("loadPolicy validates track initial range", async () => {
  const storage = MemoryStorage();
  await storage.writeAtomic(
    "bad.yaml",
    `tracks:\n  affinity:\n    min: 0\n    max: 100\n    initial: 200\n    tiers: []\n`,
  );
  const reg = createPresetRegistry([{ id: "p", extends: [], policies: [{ name: "base.yaml", doc: {} }] }]);
  try {
    await loadPolicy(storage, { preset: "p", policies: ["bad.yaml"], seed: 0 }, reg);
    expect.unreachable();
  } catch (e) {
    expect(e).toBeInstanceOf(AnimaeError);
    expect((e as AnimaeError).message).toContain("policy:tracks.affinity.initial");
  }
});

test("loadPolicy rejects unknown event in delta_table", async () => {
  const storage = MemoryStorage();
  await storage.writeAtomic("bad.yaml", `rules:\n  delta_table:\n    unknown_ev:\n      affinity: 1\n`);
  const reg = createPresetRegistry([
    {
      id: "p",
      extends: [],
      policies: [
        {
          name: "base.yaml",
          doc: {
            tracks: { affinity: { min: 0, max: 100, initial: 50, tiers: [] } },
            events: { types: {} },
          },
        },
      ],
    },
  ]);
  await expect(loadPolicy(storage, { preset: "p", policies: ["bad.yaml"], seed: 0 }, reg)).rejects.toThrow(/unknown event type/);
});

test("loadPolicy succeeds and hashes", async () => {
  const storage = MemoryStorage();
  await storage.writeAtomic("tweak.yaml", basePolicy);
  const reg = createPresetRegistry([{ id: "p", extends: [], policies: [] }]);
  const r = await loadPolicy(storage, { preset: "p", policies: ["tweak.yaml"], seed: 0 }, reg);
  expect(r.policy.tracks.affinity!.initial).toBe(50);
  expect(r.hash).toMatch(/^[a-f0-9]{64}$/);
});
