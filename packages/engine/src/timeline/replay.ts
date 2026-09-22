import type { EngineEvent, EventId, TurnChunk, TurnId } from "../types.ts";

export function eventMatches(pattern: string, kind: string): boolean {
  if (pattern === kind) return true;
  if (pattern === "*") return true;
  if (pattern.endsWith(".*")) {
    const prefix = pattern.slice(0, -1);
    return kind.startsWith(prefix);
  }
  return false;
}

export function replayChunks(events: readonly EngineEvent[]): TurnChunk[] {
  const chunks: TurnChunk[] = [];
  let currentTurn: TurnId | undefined;
  let turnEvents: EventId[] = [];
  let pendingChoices: TurnChunk | undefined;
  /** Most recent offer, so a turn driven by a choice id echoes the choice's text exactly like the live pipeline. */
  let lastOffered: readonly { id: string; text: string }[] = [];

  const flushTurn = () => {
    if (pendingChoices) {
      chunks.push(pendingChoices);
      pendingChoices = undefined;
    }
    if (currentTurn) {
      const lastUtterance = [...events].reverse().find((ev) => ev.kind === "utterance" && ev.turn === currentTurn) as
        | { speaker?: string }
        | undefined;
      chunks.push({
        type: "done",
        turnId: currentTurn,
        events: [...turnEvents],
        ...(lastUtterance?.speaker ? { speaker: lastUtterance.speaker } : {}),
      });
    }
    turnEvents = [];
  };

  for (const e of events) {
    if (e.kind === "turn.started") {
      flushTurn();
      currentTurn = e.turn;
      turnEvents = [e.id];
      continue;
    }
    if (currentTurn && e.turn === currentTurn) turnEvents.push(e.id);

    if (e.kind === "input.received") {
      // The live pipeline echoes the player's own line (typed text, or the text of the chosen option) as the first
      // chunk of a turn; replay must reproduce the same stream.
      const input = e as { actor?: string; text?: string; choiceId?: string; autonomous?: boolean };
      if (!input.autonomous) {
        const typed = (input.text ?? "").trim();
        const line = typed || (input.choiceId ? (lastOffered.find((c) => c.id === input.choiceId)?.text ?? "") : "");
        if (line) {
          chunks.push({
            type: "text",
            text: line,
            ...(input.actor ? { speaker: input.actor } : {}),
            newUtterance: true,
          });
        }
      }
    } else if (e.kind === "utterance") {
      const u = e as {
        text?: string;
        speaker?: string;
        autonomous?: boolean;
        cues?: { type: string; args: Record<string, unknown>; at: number }[];
      };
      const text = u.text ?? "";
      const speaker = u.speaker;
      const autonomous = u.autonomous;
      if (text) {
        chunks.push({
          type: "text",
          text,
          newUtterance: true,
          ...(speaker ? { speaker } : {}),
          ...(autonomous !== undefined ? { autonomous } : {}),
        });
      }
      const cues = u.cues ?? [];
      for (const cue of cues) {
        chunks.push({
          type: "cue",
          cue: { type: cue.type, args: cue.args },
          at: cue.at,
          ...(speaker ? { speaker } : {}),
        });
      }
    } else if (e.kind === "choice.offered") {
      const choices = (e as { choices?: TurnChunk extends { type: "choices" } ? never : unknown }).choices;
      const offered = (choices as import("../types.ts").Choice[]) ?? [];
      pendingChoices = { type: "choices", choices: offered };
      lastOffered = offered;
    } else if (e.kind === "turn.ended") {
      flushTurn();
      currentTurn = undefined;
    }
  }
  flushTurn();
  return chunks;
}
