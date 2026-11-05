import type { Kernel } from "../contracts.ts";
import type { RuleEnv } from "./env.ts";
import { classifyInput, type InputClass } from "./input-class.ts";

/** The S1 appraise answer, before it goes through the same schema an LLM answer does. */
export interface RuleAppraisal {
  type: string;
  intensity: number;
  sincerity: number;
  approach?: string;
  claims: { s: string; p: string; o: string }[];
  search_terms: string[];
  tags: string[];
  input_class: InputClass;
  safety?: "none";
}

/** `/<command> [intensity|tag ...]`: the word may be unicode; it ends at whitespace. */
const COMMAND = /^\s*\/([\p{L}][\p{L}\p{N}_-]*)(?:\s+([\s\S]*))?$/u;
const NUMERIC_ARG = /^(\d+(?:\.\d+)?)(%?)$/;

const COMMAND_DEFAULTS = { intensity: 0.6, sincerity: 0.8 } as const;
const CHOICE_DEFAULTS = { intensity: 0.6, sincerity: 0.8 } as const;
const BUILTIN_FALLBACK = { type: "other", intensity: 0.3, sincerity: 0.5, tags: [] as string[] } as const;

const SEARCH_TERMS_MAX = 5;

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function knownType(k: Kernel, type: string): boolean {
  return type === "other" || Object.prototype.hasOwnProperty.call(k.policy.events.types, type);
}

/** Words of a line that are worth searching memory for: segmented with the platform's word iterator, longest first. */
export function searchTermsOf(text: string): string[] {
  const seen = new Set<string>();
  const words: { word: string; at: number }[] = [];
  const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
  for (const seg of segmenter.segment(text)) {
    if (!seg.isWordLike) continue;
    const word = seg.segment.toLowerCase();
    const letters = [...word].length;
    // two letters carry meaning in scripts without word spaces; for alphabetic words two or three letters are noise
    const ascii = /^[ -~]+$/.test(word);
    if (ascii ? letters < 4 : letters < 2) continue;
    if (seen.has(word)) continue;
    seen.add(word);
    words.push({ word, at: seg.index });
  }
  words.sort((a, b) => [...b.word].length - [...a.word].length || a.at - b.at);
  return words.slice(0, SEARCH_TERMS_MAX).map((w) => w.word);
}

function fromCommand(k: Kernel, text: string): Omit<RuleAppraisal, "claims" | "search_terms" | "input_class" | "safety"> | undefined {
  const m = COMMAND.exec(text);
  if (!m) return undefined;
  const word = m[1]!.toLowerCase();
  const type = k.policy.appraise.commands?.[word] ?? word;
  if (!knownType(k, type)) return undefined;
  let intensity: number | undefined;
  const tags: string[] = [];
  for (const raw of (m[2] ?? "").split(/\s+/).filter(Boolean)) {
    const num = NUMERIC_ARG.exec(raw);
    if (num && intensity === undefined) {
      const n = Number(num[1]);
      intensity = clamp01(num[2] === "%" || n > 1 ? n / 100 : n);
    } else {
      const tag = raw.toLowerCase();
      if (!tags.includes(tag)) tags.push(tag);
    }
  }
  return { type, intensity: intensity ?? COMMAND_DEFAULTS.intensity, sincerity: COMMAND_DEFAULTS.sincerity, tags };
}

function fromPatterns(k: Kernel, text: string): Omit<RuleAppraisal, "claims" | "search_terms" | "input_class" | "safety"> | undefined {
  for (const p of k.policy.appraise.patterns ?? []) {
    let re: RegExp;
    try {
      re = new RegExp(p.match, p.flags ?? "i");
    } catch (e) {
      k.warn("RULE_PATTERN_INVALID", `appraise.patterns /${p.match}/ is not a valid regular expression: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    if (!re.test(text)) continue;
    const ev = p.event;
    return {
      type: knownType(k, ev.type) ? ev.type : "other",
      intensity: clamp01(ev.intensity ?? 0.5),
      sincerity: clamp01(ev.sincerity ?? 0.7),
      ...(ev.approach ? { approach: ev.approach } : {}),
      tags: [...(ev.tags ?? [])],
    };
  }
  return undefined;
}

/**
 * Appraises a player line without a model. Priority: (1) the metadata of the choice that was taken, (2) a
 * `/<event> [intensity|tag ...]` command, (3) `appraise.patterns` (first match), (4) `appraise.fallback`.
 */
export function ruleAppraise(env: RuleEnv): RuleAppraisal {
  const { k, ctx } = env;
  const text = ctx.input?.text ?? "";
  const choice = ctx.input?.choice;

  let base: Omit<RuleAppraisal, "claims" | "search_terms" | "input_class" | "safety"> | undefined;
  let inputClass: InputClass = "normal";

  if (choice) {
    base = {
      type: knownType(k, choice.expected_event_type) ? choice.expected_event_type : "other",
      intensity: clamp01(choice.intensity ?? CHOICE_DEFAULTS.intensity),
      sincerity: clamp01(choice.sincerity ?? CHOICE_DEFAULTS.sincerity),
      ...(choice.approach ? { approach: choice.approach } : {}),
      tags: [...choice.tags],
    };
  } else {
    base = fromCommand(k, text);
    if (!base) {
      inputClass = classifyInput(k, text);
      base = fromPatterns(k, text);
    }
  }
  if (!base) {
    const fb = k.policy.appraise.fallback ?? BUILTIN_FALLBACK;
    base = {
      type: knownType(k, fb.type) ? fb.type : "other",
      intensity: clamp01(fb.intensity),
      sincerity: clamp01(fb.sincerity),
      ...("approach" in fb && fb.approach ? { approach: fb.approach } : {}),
      tags: [...fb.tags],
    };
  }

  return {
    ...base,
    claims: [],
    search_terms: searchTermsOf(text),
    input_class: inputClass,
    ...(k.policy.safety.enabled ? { safety: "none" as const } : {}),
  };
}
