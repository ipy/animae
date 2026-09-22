import type { EventDraft, RuleCtx } from "@animae/engine";

function readRelationTrack(
  state: RuleCtx["state"],
  owner: string,
  target: string,
  track: string,
  initial: number,
): number {
  const c = state.characters[owner];
  if (!c) return initial;
  return c.tracks.toward[target]?.[track] ?? initial;
}

/** Intimidation success: additional affinity −2 and trust −2 (D&D preset). */
export function dndIntimidationExtra(ctx: Readonly<RuleCtx>): EventDraft[] {
  const selfId = (ctx.vars.self as { id?: string } | null)?.id;
  const actorId = (ctx.vars.actor as { id?: string } | null)?.id;
  if (!selfId || !actorId) return [];

  const drafts: EventDraft[] = [];
  for (const [track, delta] of [
    ["affinity", -2],
    ["trust", -2],
  ] as const) {
    const initial = track === "affinity" || track === "trust" ? 50 : 0;
    const before = readRelationTrack(ctx.state, selfId, actorId, track, initial);
    let after = before + delta;
    after = Math.max(0, Math.min(100, after));
    drafts.push({
      kind: "track.delta",
      owner: selfId,
      target: actorId,
      track,
      delta,
      before,
      after,
      eventType: (ctx.vars.event as { type?: string } | undefined)?.type ?? "other",
      reason: "dnd_intimidation",
    });
  }
  return drafts;
}

export function registerDndRules(reg: { register(name: string, fn: typeof dndIntimidationExtra): void }): void {
  reg.register("dndIntimidationExtra", dndIntimidationExtra);
}
