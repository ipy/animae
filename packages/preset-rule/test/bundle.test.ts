import { expect, test } from "bun:test";
import { celCheck } from "../../engine/src/rules/cel.ts";
import { templateExpressions } from "../../engine/src/rule-backend/template.ts";
import { createPresetRegistry, loadPolicy } from "../../engine/src/policy/index.ts";
import { stableStringify } from "../../engine/src/store/util.ts";
import { MemoryStorage } from "../../engine/src/store/memory.ts";
import presetBase from "../../preset-base/src/index.ts";
import { buildPresetBundleObject } from "../scripts/gen-bundle.ts";
import presetRule from "../src/index.ts";
import { generatedBundle } from "../src/generated.ts";

const registry = createPresetRegistry([presetBase, presetRule]);

async function loadRulePolicy() {
  const storage = MemoryStorage();
  const config = { preset: "@animae/preset-rule", policies: [], seed: 1 };
  return loadPolicy(storage, config, registry);
}

test("generated.ts matches YAML sources", async () => {
  const fresh = await buildPresetBundleObject();
  expect(stableStringify(fresh)).toBe(stableStringify(generatedBundle));
});

test("the preset extends the base preset and validates with it", async () => {
  const { policy, presets } = await loadRulePolicy();
  expect(presets.map((p) => p.id)).toEqual(["@animae/preset-base", "@animae/preset-rule"]);
  expect(policy.choices.enabled).toBe(true);
  expect(policy.choices.rules?.length).toBeGreaterThan(0);
  expect(policy.memory.writing?.importanceByEventType.lie_exposed).toBe(0.9);
  expect(policy.scene.autonomous?.rules?.[0]?.id).toBe("idle");
  // the base preset's rule backend content is inherited, not replaced
  expect(policy.render.layers?.some((l) => l.id === "narration_break")).toBe(true);
  expect(policy.appraise.patterns?.length).toBeGreaterThan(0);
});

test("command words are merged with the base preset's", async () => {
  const { policy } = await loadRulePolicy();
  expect(policy.appraise.commands).toMatchObject({ thanks: "praise", comfort: "care", threaten: "boundary_push" });
});

test("every string-table key the preset references resolves in its own or the base English table", () => {
  const tables = { ...presetBase.displayStrings!.en!, ...generatedBundle.displayStrings!.en! };
  const refs = [...JSON.stringify(generatedBundle.policies).matchAll(/\$t:([a-zA-Z0-9_.-]+)/g)].map((m) => m[1]!);
  expect(refs.length).toBeGreaterThan(0);
  expect(refs.filter((key) => tables[key] === undefined)).toEqual([]);
  for (const key of Object.keys(generatedBundle.displayStrings!.en!)) expect(refs).toContain(key);
});

test("every {{ CEL }} placeholder of the preset's strings compiles", () => {
  for (const [key, text] of Object.entries(generatedBundle.displayStrings!.en!)) {
    for (const expr of templateExpressions(text)) expect({ key, expr, error: celCheck(expr) }).toEqual({ key, expr, error: undefined });
  }
});
