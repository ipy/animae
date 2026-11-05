import type { ModelPort } from "../ports.ts";
import { AnimaeError } from "../types.ts";

/** Id of the only tier when an embedder hands the engine a single S2 `ModelPort` (or `models.s2` is a single spec). */
export const SINGLE_TIER_ID = "only";

/** One S2 tier: the id policies and routing refer to, and the port that serves it. */
export interface S2Tier {
  id: string;
  port: ModelPort;
}

/** Side jobs and the sync render, each of which can be pinned to a tier. */
export type S2Job = "render" | "offscreen" | "autonomous";

/** `models.s2.routing`: which tier serves which job. Every entry names a tier id. */
export interface TierRouting {
  render?: string;
  escalate_to?: string;
  offscreen?: string;
  autonomous?: string;
}

/**
 * The S2 tiers of an engine, in configured order (cheapest first by convention), plus the routing between them.
 * Tiers are an ordered ladder: "above" and "below" mean later and earlier in the configured list.
 */
export interface TierResolver {
  readonly list: readonly S2Tier[];
  /** Tier used when routing names none. */
  readonly defaultId: string;
  readonly routing: Readonly<TierRouting>;
  get(id: string): S2Tier | undefined;
  /** Position in the configured order; `-1` for an unknown id. */
  rank(id: string): number;
  /** Tier that serves `job` before any escalation. */
  forJob(job: S2Job): S2Tier;
  /** Tier the router upgrades to from `base` when a trigger fires; `undefined` when none is configured above `base`. */
  escalation(base: string): S2Tier | undefined;
  /** The tier one step below `id`, or `undefined` at the bottom of the ladder. */
  lower(id: string): S2Tier | undefined;
}

export function createTierResolver(
  tiers: readonly S2Tier[],
  opts: { default?: string; routing?: TierRouting } = {},
): TierResolver {
  if (tiers.length === 0) throw new AnimaeError("MODEL_CONFIG", "an S2 tier list needs at least one tier");
  const byId = new Map<string, S2Tier>();
  const order: string[] = [];
  for (const t of tiers) {
    if (byId.has(t.id)) throw new AnimaeError("MODEL_CONFIG", `duplicate S2 tier id "${t.id}"`);
    byId.set(t.id, t);
    order.push(t.id);
  }
  const routing: TierRouting = { ...(opts.routing ?? {}) };
  const defaultId = opts.default ?? tiers[0]!.id;
  const named: [string, string | undefined][] = [
    ["default", opts.default],
    ["routing.render", routing.render],
    ["routing.escalate_to", routing.escalate_to],
    ["routing.offscreen", routing.offscreen],
    ["routing.autonomous", routing.autonomous],
  ];
  for (const [where, id] of named) {
    if (id !== undefined && !byId.has(id)) {
      throw new AnimaeError("MODEL_CONFIG", `${where} names unknown S2 tier "${id}" (tiers: ${order.join(", ")})`);
    }
  }
  const must = (id: string): S2Tier => byId.get(id)!;
  return {
    list: tiers,
    defaultId,
    routing,
    get: (id) => byId.get(id),
    rank: (id) => order.indexOf(id),
    forJob(job) {
      if (job === "render") return must(routing.render ?? defaultId);
      return must(routing[job] ?? routing.render ?? defaultId);
    },
    escalation(base) {
      const id = routing.escalate_to;
      if (id === undefined) return undefined;
      return order.indexOf(id) > order.indexOf(base) ? must(id) : undefined;
    },
    lower(id) {
      const i = order.indexOf(id);
      return i > 0 ? must(order[i - 1]!) : undefined;
    },
  };
}

/** The resolver of an engine that has exactly one S2 port: a single tier named `only`. */
export function singleTierResolver(port: ModelPort): TierResolver {
  return createTierResolver([{ id: SINGLE_TIER_ID, port }]);
}
