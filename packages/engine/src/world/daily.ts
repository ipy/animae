import type { Kernel } from "../contracts.ts";
import { runStageRules } from "../rules/stages.ts";
import type { EventDraft } from "../types.ts";
import type { WorldTime } from "../types.ts";
import { kernelRulesDeps } from "./rules-deps.ts";

/** Run policy `rules.custom` entries with stage `daily` via `runStageRules`. */
export function runDailyStageRules(k: Kernel, at: WorldTime): EventDraft[] {
  const deps = kernelRulesDeps(k, { time: at });
  const vars = k.celContext({ extra: { time: at } });
  const player = k.authored.world.player;
  const fieldFx = k.m.fields.resolve({ owner: player, target: player, ctx: vars });
  return runStageRules(deps, "daily", vars, fieldFx.effects.L3, fieldFx.l3FieldRules);
}
