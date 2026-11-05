import type { ZodType } from "zod";
import type { Kernel } from "../contracts.ts";
import { currentMode, llmRoles, ruleModelOf } from "../model/select.ts";
import { buildCallContext, EMPTY_SEGMENTS } from "../pipeline/call-context.ts";
import type { PromptSegments } from "../ports.ts";
import type { EntityCallExtra } from "../rule-backend/entity.ts";
import { withRuleFallback } from "../runtime/fallback.ts";

/** Whether entity generation currently runs on a model (the S1 role on the LLM backend). */
export function entityUsesModel(k: Kernel): boolean {
  return currentMode(k).appraise === "llm" && llmRoles(k).s1;
}

/**
 * One structured entity call. Generation is structured judgment, so it is the S1 role: a model when the mode puts S1 on
 * one, otherwise the rule backend (template defaults, hints and a seeded rng). Both answer through the same schema.
 */
export async function entityObject<T>(
  k: Kernel,
  p: {
    schema: ZodType<T>;
    segments: PromptSegments;
    extra: EntityCallExtra;
    /** stable key that seeds the rule backend (the same request yields the same entity) */
    key: string;
    maxOutputTokens: number;
    temperature?: number;
  },
): Promise<T> {
  const callRule = (): Promise<T> =>
    ruleModelOf(k).object({
      label: "generate",
      purpose: "entity",
      segments: EMPTY_SEGMENTS,
      schema: p.schema,
      maxOutputTokens: p.maxOutputTokens,
      context: buildCallContext(k, { purpose: "entity", rngKey: p.key, extra: { ...p.extra } }),
    });
  if (!entityUsesModel(k)) return callRule();
  const callModel = (): Promise<T> =>
    k.models.s1.object({
      label: "generate",
      purpose: "entity",
      segments: p.segments,
      schema: p.schema,
      maxOutputTokens: p.maxOutputTokens,
      ...(p.temperature !== undefined ? { temperature: p.temperature } : {}),
    });
  return (await withRuleFallback(k, "entity", "entities", callModel, callRule)).value;
}
