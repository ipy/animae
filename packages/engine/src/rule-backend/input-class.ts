import type { Kernel } from "../contracts.ts";

/**
 * Keyword tables for the rule backend's input classification. They are English-only on purpose: the engine ships no
 * per-language data. A game adds its own phrases (in any language) through `policy.appraise.inputClass`.
 */
const DEFAULT_INJECTION: readonly string[] = [
  String.raw`\b(?:ignore|disregard|forget)\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|above|earlier)\s+(?:instructions?|prompts?|rules?|messages?)`,
  String.raw`^\s*(?:system|assistant|developer)\s*:`,
  String.raw`\byou\s+are\s+now\s+(?:a|an|in|the)\b`,
  String.raw`\b(?:reveal|show|print|repeat)\s+(?:your|the)\s+(?:system\s+)?(?:prompt|instructions)\b`,
  String.raw`\b(?:jailbreak|developer\s+mode|dan\s+mode)\b`,
];

const DEFAULT_META_PROBE: readonly string[] = [
  String.raw`\b(?:are|were)\s+you\s+(?:an?\s+)?(?:ai|a\.i\.|bot|robot|chatbot|language\s+model|llm|program|machine)\b`,
  String.raw`\b(?:what|which)\s+(?:model|llm|ai)\s+(?:are\s+you|is\s+this|do\s+you\s+run)\b`,
  String.raw`\b(?:your|the)\s+(?:system\s+)?(?:prompt|instructions|programming)\b`,
  String.raw`\b(?:this|the)\s+(?:game|story)\s+is\s+(?:fake|fiction|just\s+a\s+game)\b`,
];

export type InputClass = "normal" | "injection_suspect" | "meta_probe";

/** Compiled table per distinct list of sources (the lists only change on hot reload). */
const tableCache = new Map<string, RegExp[]>();

function table(k: Kernel, defaults: readonly string[], extra: readonly string[] | undefined): RegExp[] {
  const sources = extra && extra.length > 0 ? [...defaults, ...extra] : defaults;
  const cacheKey = sources.join("\u0000");
  const hit = tableCache.get(cacheKey);
  if (hit) return hit;
  const out: RegExp[] = [];
  for (const src of sources) {
    try {
      out.push(new RegExp(src, "i"));
    } catch (e) {
      k.warn(
        "RULE_PATTERN_INVALID",
        `appraise.inputClass pattern /${src}/ is not a valid regular expression: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  tableCache.set(cacheKey, out);
  return out;
}

/** Classifies a player line with the keyword tables (engine defaults plus the policy's own phrases). */
export function classifyInput(k: Kernel, text: string): InputClass {
  const extra = k.policy.appraise.inputClass;
  if (table(k, DEFAULT_INJECTION, extra?.injection).some((re) => re.test(text))) return "injection_suspect";
  if (table(k, DEFAULT_META_PROBE, extra?.metaProbe).some((re) => re.test(text))) return "meta_probe";
  return "normal";
}
