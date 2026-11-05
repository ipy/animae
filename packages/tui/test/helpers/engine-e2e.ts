import type { Engine } from "@animae/engine";
import { waitMs } from "./ink-harness.ts";

/**
 * The rule preset used by the TUI e2e tests answers a thank-you with one of two lines, picked by the seeded rng. The
 * rng key includes the id of the input event, and that id depends on how many background catch-up events the UI's own
 * queries appended before it, so tests accept both lines for every turn after the first.
 */
export const THANKS_REPLY = /That means a lot to me\.|You are kind to say so\./;

/** Polls an engine-side condition (the event log is the source of truth for what the UI submitted). */
export async function eventually(check: () => Promise<boolean> | boolean, timeoutMs = 4000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return true;
    await waitMs(40);
  }
  return false;
}

/** What the player submitted so far: typed text, or `choice:<id>` for a picked option. */
export async function submitted(engine: Engine): Promise<(string | undefined)[]> {
  const events = await engine.timeline.events({ kinds: ["input.received"] });
  return events.map((e) => {
    const input = e as { text?: string; choiceId?: string };
    return input.choiceId ? `choice:${input.choiceId}` : input.text;
  });
}

/** Number of turns the engine has finished on the current branch. */
export async function endedTurns(engine: Engine): Promise<number> {
  return (await engine.timeline.events({ kinds: ["turn.ended"] })).length;
}
