import type { FieldEffects } from "../schema/authored.ts";
import type { CustomRule, FieldCustomRule } from "../schema/custom-rule.ts";
import { assertPolicyCustomStage } from "../schema/custom-rule.ts";
import type { EventDraft } from "../types.ts";
import { AnimaeError } from "../types.ts";
import type { RulesDeps } from "./deps.ts";
import type { PolicyCustomStage } from "../schema/custom-rule.ts";

export interface RunCustomRulesOpts {
  stage: PolicyCustomStage;
  vars: import("../types.ts").CelContext;
  l3?: FieldEffects;
  fieldRules?: readonly FieldCustomRule[];
  rngKeyPrefix?: string;
}

type RuleSlot = CustomRule & { origin: "policy" | "field"; fieldId?: string };

function catalog(deps: RulesDeps, l3: FieldEffects | undefined, fieldRules: readonly FieldCustomRule[] | undefined): Map<string, RuleSlot> {
  const map = new Map<string, RuleSlot>();
  for (const cr of deps.policy.rules.custom ?? []) {
    assertPolicyCustomStage(cr.stage, `policy.rules.custom id "${cr.id}"`);
    map.set(cr.id, { ...cr, origin: "policy" });
  }
  for (const cr of fieldRules ?? []) {
    assertPolicyCustomStage(cr.stage, `field ${cr.fieldId} rule_add id "${cr.id}"`);
    map.set(cr.id, { id: cr.id, fn: cr.fn, when: cr.when, stage: cr.stage, origin: "field", fieldId: cr.fieldId });
  }
  return map;
}

function resolveFn(
  deps: RulesDeps,
  slot: RuleSlot,
  overrides: Record<string, string> | undefined,
  byId: Map<string, RuleSlot>,
): { fn: string; slot: RuleSlot; replacedFrom?: string } {
  const chain = slot.id;
  const replacementId = overrides?.[chain];
  if (!replacementId) return { fn: slot.fn, slot };
  const repl = byId.get(replacementId);
  if (!repl) {
    throw new AnimaeError("RULE_OVERRIDE_UNKNOWN", `rule_override maps "${chain}" to unknown rule id "${replacementId}"`);
  }
  if (!deps.rules.has(repl.fn)) {
    throw new AnimaeError("RULE_MISSING", `rule_override target "${replacementId}" uses unregistered fn "${repl.fn}"`);
  }
  return { fn: repl.fn, slot, replacedFrom: chain };
}

/** Policy custom rules for the stage, then field `rule_add` entries (deterministic order from field resolve). */
export function runCustomStageRules(deps: RulesDeps, opts: RunCustomRulesOpts): EventDraft[] {
  const { stage, vars, l3, fieldRules, rngKeyPrefix = stage } = opts;
  const overrides = l3?.rule_override;
  const byId = catalog(deps, l3, fieldRules);
  const drafts: EventDraft[] = [];

  const runOne = (slot: RuleSlot, effectiveWhen: CustomRule["when"]) => {
    const { fn, replacedFrom } = resolveFn(deps, slot, overrides, byId);
    if (!deps.rules.has(fn)) {
      throw new AnimaeError("RULE_MISSING", `custom rule "${slot.id}" references unregistered fn "${fn}"`);
    }
    if (effectiveWhen && !deps.cel.bool(effectiveWhen, vars)) return;
    const source =
      slot.origin === "field"
        ? `rules:${stage}:field:${slot.fieldId}:${slot.id}${replacedFrom ? `:override:${replacedFrom}` : ""}`
        : `rules:${stage}:${slot.id}${replacedFrom ? `:override:${replacedFrom}` : ""}`;
    const out = deps.rules.run(fn, {
      stage,
      state: deps.state,
      authored: deps.authored,
      policy: deps.policy,
      time: deps.state.time,
      vars,
      rngKey: `${rngKeyPrefix}:custom:${slot.id}${replacedFrom ? `:as:${replacedFrom}` : ""}`,
    });
    for (const d of out) {
      drafts.push({ ...d, source: d.source ?? source });
    }
  };

  for (const cr of deps.policy.rules.custom ?? []) {
    if (cr.stage !== stage) continue;
    runOne({ ...cr, origin: "policy" }, cr.when);
  }

  for (const cr of fieldRules ?? []) {
    if (cr.stage !== stage) continue;
    runOne({ id: cr.id, fn: cr.fn, when: cr.when, stage: cr.stage, origin: "field", fieldId: cr.fieldId }, cr.when);
  }

  return drafts;
}
