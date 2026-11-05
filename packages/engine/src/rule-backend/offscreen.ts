import type { RuleEnv } from "./env.ts";
import { renderTemplate } from "./template.ts";

/** Offscreen narration without a model: `offscreen.narrateTemplate` rendered for the location (empty when unset). */
export function ruleOffscreen(env: RuleEnv): { text: string } {
  const template = env.k.policy.offscreen.narrateTemplate;
  const text = template ? renderTemplate(env.k, template, env.vars, { locale: env.locale }).trim() : "";
  return { text };
}
