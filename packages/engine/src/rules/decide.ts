import type { Appraisal } from "../events.ts";
import type { FieldEffects } from "../schema/authored.ts";
import type { CharacterId, SceneId } from "../types.ts";
import { buildCelContext } from "./cel-context.ts";
import type { RulesDeps } from "./deps.ts";

export interface DecideIntentInput {
  owner: CharacterId;
  appraisal: Appraisal;
  actor: CharacterId;
  sceneId?: SceneId;
  fieldEffects?: FieldEffects;
}

export function decideIntent(
  deps: RulesDeps,
  input: DecideIntentInput,
): { intent: string; scores: Record<string, number>; forced?: boolean } {
  const { policy } = deps;

  const l2 = input.fieldEffects;
  if (l2?.intent_force) {
    return { intent: l2.intent_force, scores: { [l2.intent_force]: Infinity }, forced: true };
  }

  const scores: Record<string, number> = {};
  const ctx = buildCelContext(deps, {
    self: input.owner,
    other: input.actor,
    actor: input.actor,
    event: input.appraisal,
    sceneId: input.sceneId,
  });

  for (const rule of policy.intent_rules) {
    if (!deps.cel.bool(rule.when, ctx)) continue;
    const s = deps.cel.num(rule.score, ctx);
    scores[rule.intent] = (scores[rule.intent] ?? 0) + s;
  }

  for (const [intent, bias] of Object.entries(l2?.intent_bias ?? {})) {
    scores[intent] = (scores[intent] ?? 0) + bias;
  }

  const forbidden = new Set(l2?.intent_forbid ?? []);
  let bestIntent = policy.intent.types[0] ?? "respond";
  let bestScore = -Infinity;

  for (const rule of policy.intent_rules) {
    const s = scores[rule.intent];
    if (s === undefined || forbidden.has(rule.intent)) continue;
    if (s > bestScore) {
      bestScore = s;
      bestIntent = rule.intent;
    }
  }

  if (bestScore === -Infinity) {
    for (const t of policy.intent.types) {
      if (!forbidden.has(t)) {
        bestIntent = t;
        break;
      }
    }
  }

  return { intent: bestIntent, scores };
}
