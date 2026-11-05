import type { Kernel } from "../contracts.ts";
import type { RuleLayer } from "../schema/policy.ts";

/** Template layers for autonomous NPC exchanges (`scene.autonomous.rules`); empty when the policy has none. */
export function autonomousLayers(k: Kernel): readonly RuleLayer[] {
  return k.policy.scene.autonomous?.rules ?? [];
}

/** Whether the rule backend can voice autonomous exchanges at all. */
export function hasAutonomousRules(k: Kernel): boolean {
  return autonomousLayers(k).length > 0;
}
