import type { Kernel } from "../contracts.ts";
import type { CharacterId, EngineEvent, SceneId } from "../types.ts";
import type { TurnHistoryLine } from "./types.ts";

/** Scene context for filtering dialogue history (reflection passes ended-scene roster explicitly). */
export interface HistoryScope {
  sceneId?: SceneId;
  participants: readonly CharacterId[];
}

function sceneParticipantsFromEvents(events: readonly EngineEvent[]): Map<SceneId, Set<CharacterId>> {
  const map = new Map<SceneId, Set<CharacterId>>();
  for (const e of events) {
    if (e.kind !== "scene.started") continue;
    const p = e as { sceneId?: SceneId; participants?: CharacterId[] };
    if (!p.sceneId) continue;
    map.set(p.sceneId, new Set(p.participants ?? []));
  }
  return map;
}

function resolveScope(k: Kernel, scope?: HistoryScope): HistoryScope {
  if (scope) return scope;
  const sc = k.timeline.state().scene;
  if (sc) return { sceneId: sc.id, participants: sc.participants };
  return { participants: [] };
}

function historyLineVisible(
  k: Kernel,
  lineScene: SceneId | undefined,
  speaker: string,
  scope: HistoryScope,
  partMap: Map<SceneId, Set<CharacterId>>,
): boolean {
  if (!lineScene) return true;
  const player = k.authored.world.player;
  if (scope.sceneId && lineScene === scope.sceneId) return true;

  const isCharacter = !!k.catalog.character(speaker);
  const past = partMap.get(lineScene);
  if (!past) return false;

  if (isCharacter) return past.has(speaker);

  const current = new Set(scope.participants);
  for (const p of past) {
    if (p !== player && current.has(p)) return true;
  }
  return false;
}

/** Build recent dialogue from timeline events (last K visible turns). */
export function buildRecentHistory(
  k: Kernel,
  speaker: string,
  _addressee: string,
  limitTurns?: number,
  scope?: HistoryScope,
): TurnHistoryLine[] {
  const K = limitTurns ?? k.policy.render.recentTurns;
  const events = k.timeline.events();
  const player = k.authored.world.player;
  const resolved = resolveScope(k, scope);
  const partMap = sceneParticipantsFromEvents(events);
  const lines: { line: TurnHistoryLine; scene?: SceneId }[] = [];

  for (const e of events) {
    if (e.kind === "input.received") {
      const actor = (e as { actor?: string }).actor ?? player;
      const text = (e as { text?: string }).text ?? "";
      if (text) {
        lines.push({
          scene: e.scene,
          line: { turnId: e.turn, role: "user", speaker: actor, content: text },
        });
      }
    } else if (e.kind === "utterance") {
      const sp = (e as { speaker?: string }).speaker ?? speaker;
      const text = (e as { text?: string }).text ?? "";
      if (text) {
        lines.push({
          scene: e.scene,
          line: { turnId: e.turn, role: "assistant", speaker: sp, content: text },
        });
      }
    }
  }

  const visible = lines.filter((row) => historyLineVisible(k, row.scene, speaker, resolved, partMap));
  const turnIds = [...new Set(visible.map((r) => r.line.turnId).filter(Boolean))] as string[];
  const keep = new Set(turnIds.slice(-K));
  return visible.filter((r) => !r.line.turnId || keep.has(r.line.turnId)).map((r) => r.line);
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
