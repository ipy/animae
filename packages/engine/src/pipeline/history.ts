import type { Kernel } from "../contracts.ts";
import type { CharacterId } from "../types.ts";
import type { TurnHistoryLine } from "./types.ts";

/** Build recent dialogue from timeline events (last K turns). */
export function buildRecentHistory(k: Kernel, speaker: string, addressee: string, limitTurns?: number): TurnHistoryLine[] {
  const K = limitTurns ?? k.policy.render.recentTurns;
  const events = k.timeline.events();
  const player = k.authored.world.player;
  const lines: TurnHistoryLine[] = [];

  for (const e of events) {
    if (e.kind === "input.received") {
      const actor = (e as { actor?: string }).actor ?? player;
      const text = (e as { text?: string }).text ?? "";
      if (text) lines.push({ turnId: e.turn, role: "user", speaker: actor, content: text });
    } else if (e.kind === "utterance") {
      const sp = (e as { speaker?: string }).speaker ?? speaker;
      const text = (e as { text?: string }).text ?? "";
      if (text) lines.push({ turnId: e.turn, role: "assistant", speaker: sp, content: text });
    }
  }

  const turnIds = [...new Set(lines.map((l) => l.turnId).filter(Boolean))] as string[];
  const keep = new Set(turnIds.slice(-K));
  const filtered = lines.filter((l) => !l.turnId || keep.has(l.turnId));
  return filtered;
}

/** Who the next reply is written for, so history can be attributed in scenes with several speaking characters. */
export interface HistoryAttribution {
  speaker: CharacterId;
  /** Display name for the speaker of a history line. */
  nameOf(id: CharacterId): string;
}

export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Prompt history as chat messages.
 *
 * With one speaking character every `assistant` message is that character, so lines map one to one. As soon as the
 * window holds a reply from another character, the model would take those lines for its own earlier words and keep
 * speaking in that other voice. Then only the current speaker's replies stay `assistant`; every other line (the
 * player's and other characters') becomes a `user` message that names its speaker.
 */
export function historyToMessages(lines: TurnHistoryLine[], attribution?: HistoryAttribution): HistoryMessage[] {
  const plain = (l: TurnHistoryLine): HistoryMessage => ({ role: l.role, content: l.content });
  if (!attribution) return lines.map(plain);
  const ownLine = (l: TurnHistoryLine) => l.role === "assistant" && (l.speaker === undefined || l.speaker === attribution.speaker);
  const otherVoices = lines.some((l) => l.role === "assistant" && !ownLine(l));
  if (!otherVoices) return lines.map(plain);
  return lines.map((l): HistoryMessage => {
    if (ownLine(l)) return plain(l);
    const who = l.speaker ? attribution.nameOf(l.speaker) : "";
    return { role: "user", content: who ? `${who}: ${l.content}` : l.content };
  });
}
