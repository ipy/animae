import type { RuleEnv } from "./env.ts";
import { renderTemplate } from "./template.ts";

export interface RuleReflection {
  summaries: string[];
  goal_changes: never[];
  new_claims: never[];
}

/**
 * Reflection without a model: one summary line rendered from `reflection.summaryTemplate`. Goals and claims need
 * judgment, so the rule backend proposes none; without a template there is nothing to write.
 */
export function ruleReflection(env: RuleEnv): RuleReflection {
  const template = env.k.policy.reflection.summaryTemplate;
  const text = template ? renderTemplate(env.k, template, env.vars, { locale: env.locale }).trim() : "";
  return { summaries: text ? [text] : [], goal_changes: [], new_claims: [] };
}
