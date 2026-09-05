import type { CelContext } from "../types.ts";
import { buildCelContext } from "./cel-context.ts";
import type { RulesDeps } from "./deps.ts";

export type CustomStage = "tick" | "scene_end" | "scene_start" | "daily" | "adjudicate";

export function runStageRules(deps: RulesDeps, stage: CustomStage, vars: CelContext): import("../types.ts").EventDraft[] {
  const drafts: import("../types.ts").EventDraft[] = [];
  for (const cr of deps.policy.rules.custom ?? []) {
    if (cr.stage !== stage) continue;
    const ctx = { ...buildCelContext(deps, {}), ...vars };
    if (cr.when && !deps.cel.bool(cr.when, ctx)) continue;
    drafts.push(
      ...deps.rules.run(cr.fn, {
        stage,
        state: deps.state,
        authored: deps.authored,
        policy: deps.policy,
        time: deps.state.time,
        vars: ctx,
        rngKey: `${stage}:${cr.id}`,
      }),
    );
  }
  return drafts;
}
