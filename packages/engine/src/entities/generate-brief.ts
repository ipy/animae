import { z } from "zod";
import type { Kernel } from "../contracts.ts";
import { getPromptSection } from "../prompts/index.ts";
import { AnimaeError } from "../types.ts";
import type { SpawnCharacterSpec } from "./spawn.ts";

export const GenerationBriefSchema = z.strictObject({
  kind: z.literal("character"),
  archetype: z.string(),
  language: z.string().optional(),
  traitHints: z.record(z.string(), z.number()).optional(),
  tags: z.array(z.string()).default([]),
  avoidNames: z.array(z.string()).default([]),
  template: z.string().optional(),
});

export type GenerationBrief = z.infer<typeof GenerationBriefSchema>;

export interface GenerationPools {
  names: string[];
  traitKeys?: string[];
}

const LlmCharacterProposalSchema = z.strictObject({
  name: z.string().min(1).max(64),
  summary: z.string().default(""),
  persona: z.string().min(1),
  tags: z.array(z.string()).default([]),
  traits: z.record(z.string(), z.number()).default({}),
});

function seededPick(rng: () => number, list: string[]): string {
  if (list.length === 0) return "Stranger";
  const i = Math.floor(rng() * list.length) % list.length;
  return list[i]!;
}

/** Deterministic procedural fallback when ModelPort is unavailable or retries exhausted. */
export function proceduralCharacterFromBrief(
  k: Kernel,
  brief: GenerationBrief,
  pools: GenerationPools,
  rngKey: string,
): SpawnCharacterSpec {
  const rng = k.timeline.rng(rngKey);
  const avoid = new Set(brief.avoidNames.map((n) => n.toLowerCase()));
  const names = pools.names.filter((n) => !avoid.has(n.toLowerCase()));
  const name = seededPick(() => rng.next(), names.length ? names : ["Alex", "Jordan", "Sam"]);
  const lang = brief.language ?? k.authored.world.language;
  return {
    kind: "character",
    card: {
      identity: { name, summary: brief.archetype, language: lang, style_examples: [] },
      constraints: { motives: [], bottom_lines: [], taboos: [] },
      lod: "extra",
      tags: brief.tags,
    },
    persona: `${name} fits the archetype: ${brief.archetype}.`,
    traits: { event_mult: brief.traitHints ?? {} },
    tracks: { self: {}, toward: {}, overrides: {} },
    goals: [],
    secrets: [],
    relations: [],
    knowledge: [],
  };
}

export async function buildCharacterSpecFromBrief(
  k: Kernel,
  briefRaw: GenerationBrief,
  opts?: { pools?: GenerationPools; maxRetries?: number },
): Promise<SpawnCharacterSpec> {
  const brief = GenerationBriefSchema.parse(briefRaw);
  const pools = opts?.pools ?? { names: ["Alex", "Jordan", "Sam", "Riley", "Casey"] };
  const maxRetries = opts?.maxRetries ?? 2;
  const rngKey = `generate-brief:${brief.archetype}:${brief.tags.join(",")}`;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const loc = k.i18n.promptLocale;
      const lang = brief.language ?? k.authored.world.language;
      const segments = {
        static: getPromptSection(loc, "generate_brief_static", { archetype: brief.archetype, tag: lang }),
        semiStatic: "",
        dynamic: getPromptSection(loc, "generate_brief_avoid", {
          names: [...brief.avoidNames, ...pools.names.slice(0, 3)].join(", "),
        }),
        user: getPromptSection(loc, "generate_brief_user"),
      };
      const raw = await k.models.s2.object({
        label: "generate",
        segments,
        schema: LlmCharacterProposalSchema,
        maxOutputTokens: 2048,
        temperature: 0.6,
      });
      const proposal = LlmCharacterProposalSchema.parse(raw);
      if (brief.avoidNames.some((n) => n.toLowerCase() === proposal.name.toLowerCase())) {
        throw new AnimaeError("ENTITY_INVALID", "generated name in avoid list");
      }
      const spec: SpawnCharacterSpec = {
        kind: "character",
        card: {
          identity: { name: proposal.name, summary: proposal.summary, language: brief.language, style_examples: [] },
          constraints: { motives: [], bottom_lines: [], taboos: [] },
          lod: "extra",
          tags: [...brief.tags, ...proposal.tags],
        },
        persona: proposal.persona,
        traits: { event_mult: proposal.traits },
        tracks: { self: {}, toward: {}, overrides: {} },
        goals: [],
        secrets: [],
        relations: [],
        knowledge: [],
      };
      return spec;
    } catch (e) {
      lastErr = e;
    }
  }

  const fallback = proceduralCharacterFromBrief(k, brief, pools, `${rngKey}:fallback`);
  void lastErr;
  return fallback;
}
