import { z } from "zod";
import { Cel, Id } from "./common.ts";
import { AnimaeError } from "../types.ts";

export const CustomRuleSchema = z.strictObject({
  id: Id,
  /** name registered through `engine.rules.register(name, fn)` */
  fn: z.string(),
  when: Cel.optional(),
  stage: z.enum(["adjudicate", "tick", "scene_end", "scene_start", "daily"]).default("adjudicate"),
});
export type CustomRule = z.infer<typeof CustomRuleSchema>;

export interface FieldCustomRule extends CustomRule {
  fieldId: string;
}

/** Stages wired through `runCustomStageRules` (not schedule item `rule` hooks). */
export const POLICY_CUSTOM_STAGES = ["adjudicate", "scene_end", "scene_start", "daily"] as const;
export type PolicyCustomStage = (typeof POLICY_CUSTOM_STAGES)[number];

export function assertPolicyCustomStage(stage: string, where: string): void {
  if (stage === "tick") {
    throw new AnimaeError(
      "CONFIG_INVALID",
      `custom rule stage "tick" is not supported in ${where}: policy and field rule_add run only adjudicate, scene_start, scene_end, and daily (schedule items use registered rules with tick ctx separately)`,
    );
  }
}
