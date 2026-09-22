import type { Appraisal } from "../events.ts";
import type { ResolvedPolicy } from "../schema/policy.ts";
import type { RouteInput } from "../contracts.ts";
import { routerTriggers } from "./policy-access.ts";

type TriggerMap = NonNullable<ResolvedPolicy["router"]["triggers"]>;

function enabled(triggers: TriggerMap, key: keyof TriggerMap): boolean {
  const t = triggers[key];
  return t == null || t.enabled !== false;
}

export function isAmbiguous(appraisal: Appraisal, policy: ResolvedPolicy): boolean {
  if (appraisal.type === "other") return true;
  const def = policy.events.types[appraisal.type];
  if (def?.positive && appraisal.sincerity < 0.3) return true;
  if (appraisal.input_class === "injection_suspect" && appraisal.type !== "insincere_speech") return true;
  return false;
}

/** Evaluate router escalation triggers; returns reason keys (sorted). */
export function evaluateTriggers(input: RouteInput, policy: ResolvedPolicy): string[] {
  const reasons: string[] = [];
  const tr = routerTriggers(policy);

  if (enabled(tr, "anchor_near") && input.anchorNear) reasons.push("anchor_near");
  if (enabled(tr, "secret_topic") && input.secretTopic) reasons.push("secret_topic");
  const moodCfg = tr.mood_spike;
  if (enabled(tr, "mood_spike") && moodCfg) {
    const cfg = moodCfg;
    const a = cfg.a ?? 30;
    const b = cfg.b ?? 80;
    const delta = input.moodDelta ?? 0;
    const mood = input.mood ?? 0;
    if (Math.abs(delta) >= a || Math.abs(mood) >= b) reasons.push("mood_spike");
  }
  if (enabled(tr, "tier_change") && input.tierChanged) reasons.push("tier_change");
  if (enabled(tr, "contradiction") && input.contradiction) reasons.push("contradiction");
  if (enabled(tr, "ambiguity") && isAmbiguous(input.appraisal, policy)) reasons.push("ambiguity");
  if (enabled(tr, "field_high") && input.fieldMaxLevel >= 2) reasons.push("field_high");
  if (enabled(tr, "sidenote") && input.sidenoteReceived) reasons.push("sidenote");
  if (enabled(tr, "scene_first") && input.sceneFirstTurn) reasons.push("scene_first");

  return reasons.sort();
}
