import type { FieldDef } from "@animae/engine";

export type ConditionName = "charmed" | "frightened" | "poisoned" | "exhaustion";

export interface ConditionParams {
  /** Character receiving the condition (the holder of the field). */
  subject?: string;
  /** For exhaustion: 1–6 (default 1). For charmed: charmer character id. */
  level?: number;
  charmer?: string;
  /** Frightened: the source of fear. Only part of the field id (so several sources can be active at once). */
  source?: string;
}

const SOCIAL_SKILLS = ["persuasion", "deception", "intimidation", "performance"] as const;

/** Build a field definition for an SRD condition mapped by the D&D preset. */
export function conditionField(name: ConditionName, params: ConditionParams = {}): FieldDef {
  switch (name) {
    case "charmed": {
      const charmer = params.charmer ?? "unknown";
      const checkMod = Object.fromEntries(SOCIAL_SKILLS.map((s) => [s, { bonus: 0, advantage: "advantage" as const }]));
      return {
        id: `dnd-charmed-${charmer}`,
        holder: { kind: "character", ref: charmer },
        source: "rule",
        scope: {},
        level: "L2",
        effects: {
          check_mod: checkMod,
          intent_forbid: ["hostile"],
        },
        priority: 0,
        stacking: "override",
      };
    }
    case "frightened": {
      // The field belongs to the frightened character (the subject); the fear source only distinguishes concurrent
      // sources so several frightened fields can stack.
      const subject = params.subject ?? "unknown";
      return {
        id: params.source ? `dnd-frightened-${subject}-${params.source}` : `dnd-frightened-${subject}`,
        holder: { kind: "character", ref: subject },
        source: "rule",
        scope: {},
        level: "L1",
        effects: { check_mod: { "*": { bonus: 0, advantage: "disadvantage" } } },
        priority: 0,
        stacking: "add",
      };
    }
    case "poisoned":
      return {
        id: `dnd-poisoned-${params.subject ?? "unknown"}`,
        holder: { kind: "character", ref: params.subject ?? "unknown" },
        source: "rule",
        scope: {},
        level: "L1",
        effects: { check_mod: { "*": { bonus: 0, advantage: "disadvantage" } } },
        priority: 0,
        stacking: "add",
      };
    case "exhaustion": {
      const level = Math.max(1, Math.min(6, params.level ?? 1));
      return {
        id: `dnd-exhaustion-${level}`,
        holder: { kind: "character", ref: params.subject ?? "unknown" },
        source: "rule",
        scope: {},
        level: "L1",
        effects: { check_mod: { "*": { bonus: -2 * level } } },
        priority: 0,
        stacking: "max",
        description: `Exhaustion level ${level}`,
      };
    }
    default: {
      const _x: never = name;
      throw new Error(`unknown condition ${_x}`);
    }
  }
}
