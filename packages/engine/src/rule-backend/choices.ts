import type { RuleEnv } from "./env.ts";
import { renderTemplate } from "./template.ts";

export type RuleChoice = {
  text: string;
  expected_event_type: string;
  tags: string[];
  intensity?: number;
  sincerity?: number;
  approach?: string;
};

/**
 * Quick replies without a model: the rules of `choices.rules` whose `when` holds, in order, at most `choices.count`.
 * Each choice carries what it appraises to when taken (`event_type`, `tags`, `intensity`, `sincerity`, `approach`).
 */
export function ruleChoices(env: RuleEnv): RuleChoice[] | undefined {
  const { k } = env;
  const rules = k.policy.choices.rules;
  if (!k.policy.choices.enabled || !rules?.length) return undefined;
  const out: RuleChoice[] = [];
  for (const rule of rules) {
    if (out.length >= k.policy.choices.count) break;
    let applies: boolean;
    try {
      applies = k.rules.cel.bool(rule.when, env.vars);
    } catch (e) {
      k.warn("RULE_WHEN_ERROR", `choices.rules "${rule.id ?? rule.text}": ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    if (!applies) continue;
    const text = renderTemplate(k, rule.text, env.vars, { locale: env.locale }).trim();
    if (!text) continue;
    out.push({
      text,
      expected_event_type: rule.event_type,
      tags: [...rule.tags],
      ...(rule.intensity !== undefined ? { intensity: rule.intensity } : {}),
      ...(rule.sincerity !== undefined ? { sincerity: rule.sincerity } : {}),
      ...(rule.approach ? { approach: rule.approach } : {}),
    });
  }
  return out.length ? out : undefined;
}
