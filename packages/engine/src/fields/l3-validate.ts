import type { Kernel } from "../contracts.ts";
import type { FieldDef, FieldEffects } from "../schema/authored.ts";
import { CustomRuleSchema, assertPolicyCustomStage } from "../schema/custom-rule.ts";
import { AnimaeError } from "../types.ts";

function validateRuleAdd(entries: unknown[], where: string, k: Kernel): void {
  if (!entries?.length) return;
  for (let i = 0; i < entries.length; i++) {
    const parsed = CustomRuleSchema.safeParse(entries[i]);
    if (!parsed.success) {
      throw new AnimaeError("CONFIG_INVALID", `invalid rule_add entry at ${where}[${i}]: ${parsed.error.message}`);
    }
    assertPolicyCustomStage(parsed.data.stage, `${where}[${i}]`);
    if (!k.rules.has(parsed.data.fn)) {
      throw new AnimaeError("RULE_MISSING", `${where}[${i}] fn "${parsed.data.fn}" is not registered`);
    }
  }
}

function validateOverrides(
  overrides: Record<string, string> | undefined,
  policyIds: Set<string>,
  addIds: Set<string>,
  where: string,
): void {
  if (!overrides) return;
  for (const [from, to] of Object.entries(overrides)) {
    if (!policyIds.has(from) && !addIds.has(from)) {
      throw new AnimaeError("RULE_OVERRIDE_UNKNOWN", `${where} rule_override key "${from}" is not a policy or rule_add id`);
    }
    if (!policyIds.has(to) && !addIds.has(to)) {
      throw new AnimaeError("RULE_OVERRIDE_UNKNOWN", `${where} rule_override target "${to}" for "${from}" is unknown`);
    }
  }
}

/** Validate L3 effects on a field at grant/declare time when rule fns are known. */
export function validateFieldL3Effects(k: Kernel, def: FieldDef): void {
  if (def.level !== "L3") return;
  const fx = def.effects;
  validateL3EffectsOnly(k, fx, `field "${def.id}"`);
}

export function validateL3EffectsOnly(k: Kernel, fx: FieldEffects, where: string): void {
  const adds = fx.rule_add ?? [];
  validateRuleAdd(adds, `${where}.effects.rule_add`, k);
  const policyIds = new Set((k.policy.rules.custom ?? []).map((r) => r.id));
  const addIds = new Set(adds.map((e, i) => CustomRuleSchema.parse(e).id));
  validateOverrides(fx.rule_override, policyIds, addIds, where);
}
