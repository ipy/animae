import type { Kernel } from "../contracts.ts";
import { buildCelContext } from "../rules/cel-context.ts";
import type { RulesDeps } from "../rules/deps.ts";
import type { WorldTime } from "../types.ts";

/** Snapshot deps for pure rules helpers (`decayTicks`, `runStageRules`, …). */
export function kernelRulesDeps(k: Kernel, o?: { time?: WorldTime; sceneId?: string }): RulesDeps {
  const state = k.timeline.state();
  return {
    state,
    authored: k.authored,
    policy: k.policy,
    cel: k.rules.cel,
    rules: k.rules,
    catalog: k.catalog,
    celContext: buildCelContext(
      { state, authored: k.authored, policy: k.policy, catalog: k.catalog },
      { sceneId: o?.sceneId, extra: o?.time ? { time: o.time } : undefined },
    ),
  };
}
