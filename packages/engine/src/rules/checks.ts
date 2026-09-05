import type { Appraisal, CheckRolled } from "../events.ts";
import type { FieldEffects } from "../schema/authored.ts";
import type { CharacterId, EventDraft, Rng, SceneId, TurnId } from "../types.ts";
import { buildCelContext } from "./cel-context.ts";
import { check as rollCheck } from "./dice.ts";
import type { RulesDeps } from "./deps.ts";

export interface RunChecksInput {
  appraisal: Appraisal;
  actor: CharacterId;
  owner: CharacterId;
  sceneId?: SceneId;
  turnId: TurnId;
  fieldEffects?: FieldEffects;
  rng: Rng;
}

function checkMods(fieldEffects: FieldEffects | undefined, skill: string | undefined): { bonus: number; advantage?: boolean; disadvantage?: boolean } {
  const mods = fieldEffects?.check_mod ?? {};
  const spec = (skill && mods[skill]) || mods["*"] || { bonus: 0 };
  return {
    bonus: spec.bonus ?? 0,
    advantage: spec.advantage === "advantage" ? true : undefined,
    disadvantage: spec.advantage === "disadvantage" ? true : undefined,
  };
}

export function runChecks(
  deps: RulesDeps,
  input: RunChecksInput,
): { appraisal: Appraisal; drafts: EventDraft[]; result?: CheckRolled } {
  let appraisal = { ...input.appraisal };
  const drafts: EventDraft[] = [];
  let lastResult: CheckRolled | undefined;

  for (const rule of deps.policy.checks) {
    const ctx = buildCelContext(deps, {
      self: input.owner,
      other: input.actor,
      actor: input.actor,
      event: appraisal,
      sceneId: input.sceneId,
      check: (lastResult ?? null) as Record<string, unknown> | null,
    });

    if (!deps.cel.bool(rule.when, ctx)) continue;

    const exprRaw = deps.cel.eval<string>(rule.expr, ctx);
    const expr = typeof exprRaw === "string" ? exprRaw : String(exprRaw);
    const dc = deps.cel.num(rule.dc, ctx);
    let advantage = rule.advantage ? deps.cel.bool(rule.advantage, ctx) : false;
    let disadvantage = rule.disadvantage ? deps.cel.bool(rule.disadvantage, ctx) : false;
    const mod = checkMods(input.fieldEffects, rule.skill);
    if (mod.advantage) advantage = true;
    if (mod.disadvantage) disadvantage = true;
    if (advantage && disadvantage) {
      advantage = false;
      disadvantage = false;
    }

    const rollExpr = expr.replace(/\s+/g, "");
    const rolled = rollCheck({ expr: rollExpr, dc, rng: input.rng, advantage, disadvantage });
    if (mod.bonus !== 0) {
      rolled.total += mod.bonus;
      rolled.modifier += mod.bonus;
      rolled.success = rolled.total >= dc;
      rolled.margin = rolled.total - dc;
    }
    lastResult = {
      id: rule.id,
      expr: rollExpr,
      rolls: rolled.rolls,
      kept: rolled.kept,
      modifier: rolled.modifier,
      total: rolled.total,
      dc,
      success: rolled.success,
      margin: rolled.margin,
      advantage: advantage || undefined,
      disadvantage: disadvantage || undefined,
      skill: rule.skill,
      actor: input.actor,
      target: input.owner,
    };

    drafts.push({ kind: "check.rolled", source: "rules:check", ...lastResult });

    const hook = rolled.success ? rule.onSuccess : rule.onFailure;
    if (hook?.setType) appraisal = { ...appraisal, type: hook.setType };
    if (hook?.addTags?.length) appraisal = { ...appraisal, tags: [...new Set([...appraisal.tags, ...hook.addTags])] };
    if (hook?.emit?.length) drafts.push(...hook.emit.map((e) => ({ ...e, kind: e.kind })));
  }

  return { appraisal, drafts, result: lastResult };
}
