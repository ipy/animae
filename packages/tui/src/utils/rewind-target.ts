import type { Engine, EventId } from "@animae/engine";

/**
 * The event to fork the timeline at so that the last turn never happened: the one just before that turn's
 * `turn.started`, which is where the previous turn ended (a fork inside a turn would leave the new branch with a turn
 * that never ends). `undefined` when the branch holds no turn that can be undone (none played yet, or the first event
 * of the log is the turn's own start).
 */
export async function lastTurnRewindTarget(engine: Pick<Engine, "timeline">): Promise<EventId | undefined> {
  const events = await engine.timeline.events();
  for (let i = events.length - 1; i > 0; i--) {
    if (events[i]!.kind === "turn.started") return events[i - 1]!.id;
  }
  return undefined;
}
