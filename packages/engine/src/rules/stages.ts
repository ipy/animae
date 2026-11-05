import type { FieldEffects } from "../schema/authored.ts";
import type { FieldCustomRule } from "../schema/custom-rule.ts";
import type { CelContext } from "../types.ts";
import { aggregatedEventProb } from "../fields/caps.ts";
import { buildCelContext } from "./cel-context.ts";
import type { RulesDeps } from "./deps.ts";
import { runCustomStageRules } from "./l3-custom.ts";
import type { PolicyCustomStage } from "../schema/custom-rule.ts";

export type CustomStage = PolicyCustomStage;

export function runStageRules(
  deps: RulesDeps,
  stage: CustomStage,
  vars: CelContext,
  l3?: FieldEffects,
  fieldRules?: readonly FieldCustomRule[],
): import("../types.ts").EventDraft[] {
  const ctx = {
    ...buildCelContext(
      {
        state: deps.state,
        authored: deps.authored,
        policy: deps.policy,
        catalog: deps.catalog,
        fieldEffects: deps.fieldEffects,
      },
      {},
    ),
    ...vars,
  };
  if (deps.fieldEffects) {
    const prob = aggregatedEventProb(deps.fieldEffects);
    const fields =
      ctx.fields && typeof ctx.fields === "object" && !Array.isArray(ctx.fields)
        ? { ...(ctx.fields as Record<string, unknown>) }
        : {};
    fields.event_prob = prob;
    ctx.fields = fields;
  }
  return runCustomStageRules(deps, { stage, vars: ctx, l3, fieldRules });
}
