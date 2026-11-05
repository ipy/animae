import type { RuleEnv } from "./env.ts";
import { renderTemplate } from "./template.ts";

export interface RuleMemoryWrite {
  text: string;
  importance: number;
  valence: number;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Structured memory write without a model: `memory.writing.template` for the text, the per-event-type tables for
 * importance and valence (falling back to the appraised intensity and the sign of the mood change).
 */
export function ruleMemoryWrite(env: RuleEnv): RuleMemoryWrite {
  const { k, ctx } = env;
  const writing = k.policy.memory.writing;
  const ev = (ctx.event ?? {}) as { type?: string; intensity?: number };
  const type = ev.type ?? "other";
  const extra = (ctx.extra ?? {}) as { defaultValence?: number; maxChars?: number; text?: string };
  const rendered = renderTemplate(k, writing?.template ?? "{{text}}", env.vars, { locale: env.locale }).trim();
  const maxChars = extra.maxChars ?? k.policy.memory.write?.maxChars ?? 240;
  const text = (rendered || String(extra.text ?? "")).slice(0, maxChars);
  const importance = clamp(writing?.importanceByEventType[type] ?? ev.intensity ?? 0.5, 0, 1);
  const valence = clamp(writing?.valenceByEventType[type] ?? extra.defaultValence ?? 0, -1, 1);
  return { text, importance, valence };
}
