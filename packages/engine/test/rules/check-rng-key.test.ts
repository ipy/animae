import { expect, test } from "bun:test";
import { createCelEngine } from "../../src/rules/cel.ts";
import { createRuleEngine } from "../../src/rules/rule-engine.ts";
import { runChecks } from "../../src/rules/checks.ts";
import { buildCelContext } from "../../src/rules/cel-context.ts";
import { applyPolicyDefaults } from "../../src/policy/defaults.ts";
import { createRng } from "../../src/timeline/rng.ts";
import { charDef, createPipelineKernel } from "../pipeline/test-kernel.ts";

test("check RNG is keyed by turn id for replay stability", () => {
  const policy = applyPolicyDefaults({
    checks: [{ id: "c1", when: "true", expr: "'1d20'", dc: "10" }],
    events: { types: { chat: { positive: false } } },
  });
  const { k } = createPipelineKernel({ policy, chars: [charDef("npc1"), charDef("player")] });
  const cel = createCelEngine();
  const rules = createRuleEngine(cel);
  const appraisal = {
    type: "chat",
    intensity: 0,
    sincerity: 1,
    claims: [],
    search_terms: [],
    tags: [],
    input_class: "normal" as const,
  };
  const baseDeps = {
    state: k.timeline.state(),
    authored: k.authored,
    policy: k.policy,
    cel,
    rules,
    catalog: k.catalog,
    celContext: buildCelContext(
      { state: k.timeline.state(), authored: k.authored, policy: k.policy, catalog: k.catalog },
      { self: "npc1", other: "player", actor: "player", event: appraisal },
    ),
  };
  const roll = (turnId: string) =>
    runChecks(baseDeps, {
      appraisal,
      actor: "player",
      owner: "npc1",
      turnId,
      rng: k.timeline.rng(`check:${turnId}`),
    }).drafts.find((d) => d.kind === "check.rolled") as { total?: number };

  const a = roll("turn_a");
  const b = roll("turn_a");
  const c = roll("turn_b");
  expect(a.total).toBe(b.total);
  expect(c.total).not.toBe(a.total);
  expect(createRng(1, "main", "check:turn_a").next()).toBe(createRng(1, "main", "check:turn_a").next());
});
