import { z } from "zod";
import type { ResolvedPolicy } from "../schema/policy.ts";
import { coerceAppraiseRaw, coerceRenderRaw } from "./coerce.ts";

const claimSchema = z.strictObject({ s: z.string(), p: z.string(), o: z.string() });

export function buildAppraiseSchema(policy: ResolvedPolicy) {
  const typeKeys = Object.keys(policy.events.types);
  const typeEnum = typeKeys.length > 0 ? z.enum(typeKeys as [string, ...string[]]) : z.string();
  const approaches = (policy.x?.approaches as string[] | undefined) ?? [];
  const approachSchema =
    approaches.length > 0 ? z.enum(approaches as [string, ...string[]]).optional() : z.string().optional();

  const base = {
    type: typeKeys.length > 0 ? z.union([typeEnum, z.string()]) : z.string(),
    intensity: z.number(),
    sincerity: z.number(),
    approach: approachSchema,
    claims: z.array(claimSchema).default([]),
    search_terms: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    input_class: z.enum(["normal", "injection_suspect", "meta_probe"]),
  };

  const inner =
    policy.safety.enabled
      ? z.strictObject({
          ...base,
          safety: z.enum(["none", "self_harm", "real_world_danger", "sexual_minors", "personal_crisis"]),
        })
      : z.strictObject(base);

  return z.preprocess((raw) => {
    const rec = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    return coerceAppraiseRaw(rec, policy);
  }, inner);
}

export function buildRenderSchema(policy: ResolvedPolicy) {
  /** Loose cue rows — strict validation happens in `renderStage` (`validateCues`). */
  const cueUnion = z.strictObject({
    type: z.string(),
    args: z.record(z.string(), z.unknown()).default({}),
    at: z.number().int().min(0).optional(),
  });
  void policy.cues.types;

  const choiceSchema = z.strictObject({
    text: z.string(),
    expected_event_type: z.string(),
    tags: z.array(z.string()).default([]),
  });

  const base = {
    text: z.string(),
    cues: z.array(cueUnion).default([]),
    intent_realized: z.string(),
  };

  const inner =
    policy.choices.enabled
      ? z.strictObject({ ...base, choices: z.array(choiceSchema).optional() })
      : z.strictObject(base);

  return z.preprocess((raw) => {
    const rec = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    return coerceRenderRaw(rec);
  }, inner);
}
