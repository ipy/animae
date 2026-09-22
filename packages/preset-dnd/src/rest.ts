import type { FieldDef } from "@animae/engine";
import { conditionField } from "./conditions.ts";

const SHORT_REST_MINUTES = 60;
const LONG_REST_MINUTES = 480;

export interface RestEngine {
  world: {
    advance(by: number): Promise<unknown[]>;
  };
  fields: {
    revoke(id: string): void;
    grant(field: FieldDef): unknown;
  };
  /** Optional: list active field ids on a character (for long-rest exhaustion cleanup). */
  listFieldIds?(characterId: string): string[];
}

function exhaustionLevelFromId(id: string): number | undefined {
  const m = /^dnd-exhaustion-(\d+)$/.exec(id);
  return m ? Number(m[1]) : undefined;
}

/**
 * Short rest: advance world time 60 minutes. Long rest: 480 minutes and reduce exhaustion by 1 level.
 */
export async function rest(engine: RestEngine, kind: "short" | "long", characterId = "player"): Promise<void> {
  const minutes = kind === "short" ? SHORT_REST_MINUTES : LONG_REST_MINUTES;
  await engine.world.advance(minutes);
  if (kind !== "long") return;

  const ids = engine.listFieldIds?.(characterId) ?? [];
  let maxLevel = 0;
  for (const id of ids) {
    const lv = exhaustionLevelFromId(id);
    if (lv !== undefined) maxLevel = Math.max(maxLevel, lv);
  }
  if (maxLevel <= 0) return;

  for (const id of ids) {
    if (exhaustionLevelFromId(id) !== undefined) engine.fields.revoke(id);
  }
  const next = maxLevel - 1;
  if (next >= 1) engine.fields.grant(conditionField("exhaustion", { level: next }));
}

export const REST_DURATIONS = { short: SHORT_REST_MINUTES, long: LONG_REST_MINUTES } as const;
