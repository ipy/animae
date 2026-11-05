import type { FieldEffects } from "../../src/schema/authored.ts";

/** Intentionally invalid rule_add rows for L3 validate tests (schema checked at runtime). */
export function fieldEffectsWithRuleAdd(entries: readonly unknown[]): FieldEffects {
  return { rule_add: entries as FieldEffects["rule_add"] };
}
