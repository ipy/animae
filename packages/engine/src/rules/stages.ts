import type { FieldEffects } from "../schema/authored.ts";
import type { FieldCustomRule } from "../schema/custom-rule.ts";
import type { CelContext } from "../types.ts";
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
  const ctx = { ...buildCelContext(deps, {}), ...vars };
  return runCustomStageRules(deps, { stage, vars: ctx, l3, fieldRules });
}
