import type { Kernel } from "../contracts.ts";
import type { DeckDef, DeckEntry } from "../schema/decks.ts";
import type { DeckRuntimeState } from "../state.ts";
import type { EventDraft, WorldTime } from "../types.ts";
import { chapterAt } from "./calendar.ts";

export type { DeckRuntimeState } from "../state.ts";

export function emptyDeckState(): DeckRuntimeState {
  return { drawsToday: 0, onceUsed: [] };
}

function entryEligible(
  k: Kernel,
  deck: DeckDef,
  entry: DeckEntry,
  st: DeckRuntimeState,
  at: WorldTime,
  day: number,
): { ok: boolean; reason?: string } {
  if (entry.once && st.onceUsed.includes(entry.id)) return { ok: false, reason: "once" };
  if (entry.cooldownDays && st.lastDrawDay !== undefined && day - st.lastDrawDay < entry.cooldownDays) {
    return { ok: false, reason: "cooldown" };
  }
  if (entry.when) {
    const ctx = k.celContext({ extra: { time: at, deck: { id: deck.id, entry: entry.id } } });
    if (!k.rules.cel.bool(entry.when, ctx)) return { ok: false, reason: "when" };
  }
  return { ok: true };
}

/** Weighted random draw; deterministic via timeline RNG. */
export function drawDeckEntry(
  k: Kernel,
  deck: DeckDef,
  at: WorldTime,
): { entry: DeckEntry; candidates: { id: string; weight: number; excluded?: string }[] } | null {
  const state = k.timeline.state();
  const day = at.day;
  const st = (state.decks ?? {})[deck.id] ?? emptyDeckState();

  if (deck.maxPerDay !== undefined && st.drawsToday >= deck.maxPerDay) return null;

  const eligible: DeckEntry[] = [];
  const candidates: { id: string; weight: number; excluded?: string }[] = [];
  for (const entry of deck.entries) {
    const w = entry.weight ?? 1;
    candidates.push({ id: entry.id, weight: w });
    const check = entryEligible(k, deck, entry, st, at, day);
    if (!check.ok) {
      candidates[candidates.length - 1]!.excluded = check.reason;
      continue;
    }
    eligible.push(entry);
  }
  if (eligible.length === 0) return null;

  const total = eligible.reduce((s, e) => s + (e.weight ?? 1), 0);
  let roll = k.timeline.rng(`deck:${deck.id}:${day}:${at.minute}`).next() * total;
  let picked = eligible[0]!;
  for (const e of eligible) {
    roll -= e.weight ?? 1;
    if (roll <= 0) {
      picked = e;
      break;
    }
  }
  return { entry: picked, candidates };
}

export function draftsForDeckDraw(
  k: Kernel,
  deck: DeckDef,
  at: WorldTime,
): EventDraft[] {
  const drawn = drawDeckEntry(k, deck, at);
  if (!drawn) return [];
  const { entry, candidates } = drawn;
  const out: EventDraft[] = [
    {
      kind: "deck.drawn",
      deckId: deck.id,
      entryId: entry.id,
      weight: entry.weight ?? 1,
      tags: entry.tags ?? [],
      entryOnce: entry.once,
      candidates: candidates.map((c) => ({ id: c.id, weight: c.weight, excluded: c.excluded })),
      at: { ...at },
      t: { ...at },
      source: `deck:${deck.id}`,
    },
  ];
  if (entry.emit) {
    const raw = Array.isArray(entry.emit) ? entry.emit : [entry.emit];
    for (const d of raw) {
      out.push({
        ...(d as EventDraft),
        t: (d as EventDraft).t ?? { ...at },
        source: (d as EventDraft).source ?? `deck:${deck.id}:${entry.id}`,
      });
    }
  }
  return out;
}

export function runDeckDrawsForDay(k: Kernel, at: WorldTime): EventDraft[] {
  const cal = k.authored.world.calendar;
  const chapter = chapterAt(at, cal);
  const out: EventDraft[] = [];
  for (const deck of k.authored.decks ?? []) {
    if (deck.drawOn !== "day") continue;
    if (deck.chapter && deck.chapter !== chapter?.id) continue;
    if (deck.when) {
      const ctx = k.celContext({ extra: { time: at, deck: { id: deck.id } } });
      if (!k.rules.cel.bool(deck.when, ctx)) continue;
    }
    out.push(...draftsForDeckDraw(k, deck, at));
  }
  return out;
}

export function reduceDeckDrawn(
  decks: Record<string, DeckRuntimeState>,
  deckId: string,
  entryId: string,
  at: WorldTime,
  entryOnce?: boolean,
): Record<string, DeckRuntimeState> {
  const prev = decks[deckId] ?? emptyDeckState();
  const sameDay = prev.lastDrawDay === at.day;
  const onceUsed = [...prev.onceUsed];
  if (entryOnce && !onceUsed.includes(entryId)) onceUsed.push(entryId);
  return {
    ...decks,
    [deckId]: {
      lastDrawDay: at.day,
      drawsToday: sameDay ? prev.drawsToday + 1 : 1,
      onceUsed,
      lastEntryId: entryId,
      lastDrawAt: { ...at },
    },
  };
}

/** Reset per-day draw counters when the calendar day changes. */
export function resetDeckDailyCounters(decks: Record<string, DeckRuntimeState>, newDay: number): Record<string, DeckRuntimeState> {
  const out: Record<string, DeckRuntimeState> = {};
  for (const [id, st] of Object.entries(decks)) {
    if (st.lastDrawDay === newDay) {
      out[id] = st;
      continue;
    }
    out[id] = { ...st, drawsToday: 0 };
  }
  return out;
}
