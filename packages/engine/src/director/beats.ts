import type { CelEngine } from "../contracts.ts";
import type { BeatDef } from "../schema/authored.ts";
import type { EventDraft } from "../types.ts";

export function evaluateBeats(
  beats: BeatDef[],
  current: string | null,
  cel: CelEngine,
  ctx: Record<string, unknown>,
): { current: string | null; events: EventDraft[]; enteredFields: string[] } {
  const events: EventDraft[] = [];
  let active = current;
  let enteredFields: string[] = [];

  if (active) {
    const beat = beats.find((b) => b.id === active);
    if (beat && cel.bool(beat.exit, ctx)) {
      events.push({ kind: "beat.exited", beat: beat.id, source: "director" });
      active = null;
    }
  }

  if (!active) {
    for (const beat of beats) {
      if (cel.bool(beat.enter, ctx)) {
        active = beat.id;
        events.push({ kind: "beat.entered", beat: beat.id, source: "director" });
        enteredFields = [...beat.fields];
        break;
      }
    }
  }

  return { current: active, events, enteredFields };
}

export function beatNote(beats: BeatDef[], current: string | null): string | undefined {
  if (!current) return undefined;
  return beats.find((b) => b.id === current)?.note;
}
