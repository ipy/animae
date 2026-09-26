import type { Policy, ResolvedPolicy } from "../schema/policy.ts";

const LEVEL_ORDER = ["L0", "L1", "L2", "L3", "L4"] as const;

export function levelRank(level: string): number {
  const i = LEVEL_ORDER.indexOf(level as (typeof LEVEL_ORDER)[number]);
  return i >= 0 ? i : -1;
}

/** Apply spec defaults so every policy section is present on the loader output. */
export function applyPolicyDefaults(merged: Policy): ResolvedPolicy {
  const memoryWeights = {
    term: 0.5,
    recency: 0.2,
    importance: 0.2,
    salience: 0.1,
    vector: 0.3,
    ...(merged.memory?.weights ?? {}),
  };

  const routerBudget = {
    syncCallsPerTurn: 2,
    s2PerTurn: 1,
    s2Ratio: 0.15,
    s2ReservedForAnchors: 0.03,
    maxOutputTokens: { s1: 400, s2: 800 },
    ...(merged.router?.budget ?? {}),
  };

  return {
    schema: merged.schema,
    x: merged.x ?? {},
    events: merged.events ?? { types: {} },
    tracks: merged.tracks ?? {},
    rules: {
      delta_table: merged.rules?.delta_table ?? {},
      marginal: merged.rules?.marginal ?? { k: 0.5, halfLifeHours: 24 },
      turn_cap: merged.rules?.turn_cap ?? {},
      windows: merged.rules?.windows ?? [],
      thresholds: merged.rules?.thresholds ?? [],
      custom: merged.rules?.custom ?? [],
    },
    intent: merged.intent ?? { types: [] },
    intent_rules: merged.intent_rules ?? [],
    input: { response: merged.input?.response ?? ({} as Record<"injection_suspect" | "meta_probe", never>) },
    safety: merged.safety ?? { enabled: false, response: "in_character", log: false },
    fields: merged.fields ?? { grants: [], caps: {} },
    memory: {
      k: merged.memory?.k ?? 8,
      recencyHalfLifeDays: merged.memory?.recencyHalfLifeDays ?? 7,
      indexMax: merged.memory?.indexMax ?? 50,
      weights: memoryWeights,
      write: merged.memory?.write ?? { episodic: true, minIntensity: 0.2, maxChars: 240 },
      forgetting: merged.memory?.forgetting ?? { enabled: false, tau: 30, threshold: 0.2 },
      distortion: merged.memory?.distortion ?? {
        enabled: false,
        p: 0.1,
        maxImportance: 0.7,
        kinds: ["intensify"],
      },
      propagation: merged.memory?.propagation ?? { enabled: false, onTick: "day", distortionPerHop: 1 },
    },
    reflection: merged.reflection ?? { enabled: true, accept: "!conflict" },
    characters: merged.characters ?? { lod: { promote: [] } },
    offscreen: merged.offscreen ?? {
      fidelity: { default: "rule", locations: {}, characters: {} },
    },
    scene: merged.scene ?? {
      turnTaking: "addressed",
      autonomous: { maxExchangesPerPlayerTurn: 0, when: "true" },
    },
    router: {
      triggers: merged.router?.triggers ?? {},
      budget: routerBudget,
      degrade: merged.router?.degrade ?? [],
    },
    render: {
      retryOnMismatch: merged.render?.retryOnMismatch ?? 0,
      recentTurns: merged.render?.recentTurns ?? 12,
      temperature: merged.render?.temperature,
      maxSegmentChars: merged.render?.maxSegmentChars,
      knowledgeIndexMax: merged.render?.knowledgeIndexMax,
      relation: merged.render?.relation,
      recall: merged.render?.recall,
    },
    cues: merged.cues ?? { types: {} },
    choices: merged.choices ?? { enabled: false, count: 3, filter: "true" },
    timeline: merged.timeline ?? { allowRewind: true, carry: [] },
    visibility: merged.visibility ?? { rules: [] },
    checks: merged.checks ?? [],
  };
}
