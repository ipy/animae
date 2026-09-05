import { test, expect } from "bun:test";
import { stableStringify } from "../../engine/src/store/util.ts";
import { buildPresetBundleObject } from "../scripts/gen-bundle.ts";
import { generatedBundle } from "../src/generated.ts";
import { loadBasePolicy, loadDndPolicy, registry } from "./helpers.ts";
import { loadPolicy } from "../../engine/src/policy/index.ts";
import { MemoryStorage } from "../../engine/src/store/memory.ts";
import presetBase from "../src/index.ts";
import presetDnd from "../../preset-dnd/src/index.ts";

test("generated.ts matches YAML sources", async () => {
  const fresh = await buildPresetBundleObject();
  expect(stableStringify(fresh)).toBe(stableStringify(generatedBundle));
});

test("preset-base bundle validates via loadPolicy", async () => {
  const policy = await loadBasePolicy();
  expect(policy.tracks.affinity!.initial).toBe(50);
  expect(policy.rules.delta_table!.care).toEqual({ affinity: 4, trust: 2, mood: 10 });
  expect(policy.intent.types).toEqual(["respond", "comply", "refuse", "negotiate", "deflect"]);
});

test("preset-dnd extends base and validates", async () => {
  const policy = await loadDndPolicy();
  expect(policy.checks.length).toBeGreaterThanOrEqual(7);
  expect(policy.x?.approaches).toContain("persuasion");
  expect(policy.schema?.extend?.traits?.level).toBeDefined();
});

test("registry resolves extends chain", async () => {
  const storage = MemoryStorage();
  await storage.writeAtomic("animae.yaml", 'preset: "@animae/preset-dnd"\nseed: 1\npolicies: []\n');
  const r = await loadPolicy(storage, { preset: "@animae/preset-dnd", policies: [], seed: 1 }, registry, {
    knownRuleFns: new Set(["dndIntimidationExtra"]),
  });
  expect(r.policy.rules.delta_table!.insult?.mood).toBe(-20);
  expect(r.presets.map((p) => p.id)).toEqual(["@animae/preset-base", "@animae/preset-dnd"]);
  expect(presetBase.id).toBe("@animae/preset-base");
  expect(presetDnd.notice).toContain("SRD 5.2.1");
});
