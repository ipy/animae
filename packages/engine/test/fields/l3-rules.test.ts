import { describe, expect, test } from "bun:test";
import { createFieldSystem } from "../../src/fields/field-system.ts";
import { createRuleEngine } from "../../src/rules/rule-engine.ts";
import { runCustomStageRules } from "../../src/rules/l3-custom.ts";
import { kernelRulesDeps } from "../../src/world/rules-deps.ts";
import { buildTestKernel, minimalAuthored, openPolicy } from "../helpers/fake-kernel.ts";
import type { FieldDef } from "../../src/schema/authored.ts";
import { AnimaeError } from "../../src/types.ts";

const l3Field = (over: Partial<FieldDef>): FieldDef => ({
  id: "f_l3",
  holder: { kind: "world" },
  source: "author",
  scope: {},
  level: "L3",
  effects: {},
  priority: 0,
  stacking: "add",
  ...over,
});

function policyWithCustom(custom: NonNullable<ReturnType<typeof openPolicy>["rules"]>["custom"]) {
  const base = openPolicy();
  return { ...base, rules: { ...base.rules, custom } };
}

describe("L3 rule_add and rule_override", () => {
  test("rule_add runs only while field is in scope", async () => {
    const runs: string[] = [];
    const authored = minimalAuthored({
      fields: {
        mod: l3Field({
          id: "mod",
          holder: { kind: "location", ref: "cafe" },
          scope: { scene: "scn_1" },
          effects: { rule_add: [{ id: "extra", fn: "mark_run", stage: "scene_start" }] },
        }),
      },
    });
    const k = buildTestKernel(authored);
    k.rules.register("mark_run", () => {
      runs.push("yes");
      return [{ kind: "note.written", text: "ok" }];
    });

    await k.timeline.append([
      { kind: "scene.started", sceneId: "scn_1", location: "cafe", participants: ["player", "npc"], fields: [], source: "test" },
    ] as never);
    const fx = k.fields.resolve({
      scene: { id: "scn_1", location: "cafe", participants: ["player", "npc"], turn: 0 },
      ctx: k.celContext({ sceneId: "scn_1" }),
    });
    const deps = kernelRulesDeps(k, { sceneId: "scn_1" });
    runCustomStageRules(deps, {
      stage: "scene_start",
      vars: deps.celContext,
      l3: fx.effects.L3,
      fieldRules: fx.l3FieldRules,
    });
    expect(runs).toEqual(["yes"]);

    runs.length = 0;
    const outOfScope = k.fields.resolve({
      scene: { id: "scn_other", location: "cafe", participants: ["player", "npc"], turn: 0 },
      ctx: k.celContext({ sceneId: "scn_other" }),
    });
    runCustomStageRules(deps, {
      stage: "scene_start",
      vars: deps.celContext,
      l3: outOfScope.effects.L3,
      fieldRules: outOfScope.l3FieldRules,
    });
    expect(runs).toEqual([]);
  });

  test("rule_override swaps fn and restores when field ends", () => {
    const log: string[] = [];
    const policy = policyWithCustom([{ id: "base", fn: "base_fn", stage: "daily" }]);
    const authored = minimalAuthored({
      fields: {
        swap: l3Field({
          id: "swap",
          effects: {
            rule_override: { base: "alt" },
            rule_add: [{ id: "alt", fn: "alt_fn", stage: "scene_end" }],
          },
        }),
      },
    });
    const k = buildTestKernel(authored, policy);
    k.rules.register("base_fn", () => {
      log.push("base");
      return [];
    });
    k.rules.register("alt_fn", () => {
      log.push("alt");
      return [];
    });

    const fx = k.fields.resolve({ ctx: k.celContext({}) });
    const deps = kernelRulesDeps(k, {});
    runCustomStageRules(deps, { stage: "daily", vars: deps.celContext, l3: fx.effects.L3, fieldRules: fx.l3FieldRules });
    expect(log).toEqual(["alt"]);

    log.length = 0;
    runCustomStageRules(deps, { stage: "daily", vars: deps.celContext, l3: {}, fieldRules: [] });
    expect(log).toEqual(["base"]);
  });

  test("unknown override target fails loudly", () => {
    const k = buildTestKernel(
      minimalAuthored({
        fields: { bad: l3Field({ id: "bad", effects: { rule_override: { missing: "nope" } } }) },
      }),
    );
    k.rules.register("x", () => []);
    expect(() => k.fields.declare(l3Field({ id: "bad2", effects: { rule_override: { a: "b" } } }))).toThrow(AnimaeError);
  });

  test("malformed rule_add rejected by schema at field parse", () => {
    const k = buildTestKernel(minimalAuthored());
    k.rules.register("ok", () => []);
    expect(() =>
      k.fields.declare(
        l3Field({
          effects: { rule_add: [{ id: "x", fn: "ok", stage: "tick" as "daily" }] },
        }),
      ),
    ).toThrow(AnimaeError);
  });

  test("duplicate rule_add ids: last array entry wins within resolve order", () => {
    const authored = minimalAuthored({
      fields: {
        f1: l3Field({
          id: "f1",
          priority: 1,
          effects: { rule_add: [{ id: "dup", fn: "first", stage: "scene_end" }] },
        }),
        f2: l3Field({
          id: "f2",
          priority: 0,
          effects: { rule_add: [{ id: "dup", fn: "second", stage: "scene_end" }] },
        }),
      },
    });
    const k = buildTestKernel(authored);
    k.rules.register("first", () => []);
    k.rules.register("second", () => []);
    const fx = k.fields.resolve({ ctx: k.celContext({}) });
    expect(fx.l3FieldRules).toHaveLength(1);
    expect(fx.l3FieldRules[0]!.fn).toBe("second");
  });
});
