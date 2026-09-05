import type { Kernel } from "../contracts.ts";
import type { TurnHistoryLine } from "./types.ts";

/** Build recent dialogue from timeline events (§17.4 K turns). */
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

export function historyToMessages(lines: TurnHistoryLine[]): { role: "user" | "assistant"; content: string }[] {
  return lines.map((l) => ({ role: l.role, content: l.content }));
}
