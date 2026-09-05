import type { Director, DirectorTick, FieldSystem, Kernel, LedgerEntry } from "../contracts.ts";
import type { FieldDef } from "../schema/authored.ts";
import type { CharacterId, EngineEvent, EventDraft, WorldTime } from "../types.ts";
import { worldMinutes } from "../timeline/time.ts";
import {
  activeAnchorStatus,
  anchorDeadlineMinutes,
  anchorNear,
  anchorTargetMet,
  anchorsReferencing,
  ensureForceField,
  ensureSoftField,
  isLastTurnBeforeDeadline,
  isTerminal,
  scenesUntilDeadline,
} from "./anchors.ts";
import { beatNote, evaluateBeats } from "./beats.ts";
import { exceptionPeriodKey } from "./exceptions.ts";
import { hasVerbatimEcho } from "./sidenotes.ts";

function createDirectorImpl(k: Kernel, getFields: () => FieldSystem): Director {
  const armedBypass = new Set<string>();

  function celCtx(extra?: Record<string, unknown>, asOf?: WorldTime) {
    const time = asOf ?? k.timeline.state().time;
    return k.celContext({ sceneId: k.timeline.state().scene?.id, extra: { ...extra, time } });
  }

  function eventTime(asOf?: WorldTime): WorldTime | undefined {
    return asOf ? { ...asOf } : undefined;
  }

  function toMinutes(t: { day: number; minute: number }): number {
    return worldMinutes(t);
  }

  function nearestAnchorMetrics(): { nearest: number; near: boolean } {
    const state = k.timeline.state();
    const sceneMinutes = k.authored.world.calendar.sceneMinutes;
    const n = k.policy.router?.triggers?.anchor_near?.n ?? 1;
    let nearest = Infinity;
    const ctx = celCtx();
    const now = toMinutes(state.time);

    for (const anchor of k.authored.anchors) {
      const st = activeAnchorStatus(state, anchor.id);
      if (isTerminal(st.status)) continue;
      const deadline = anchorDeadlineMinutes(anchor, k.rules.cel, ctx, toMinutes);
      if (deadline === undefined) continue;
      const scenes = scenesUntilDeadline(deadline, now, sceneMinutes);
      nearest = Math.min(nearest, scenes);
    }
    return { nearest, near: anchorNear(nearest, n) };
  }

  async function tick(
    when: "scene_start" | "turn_start" | "turn_end" | "time_advanced",
    opts?: { asOf?: WorldTime },
  ): Promise<DirectorTick> {
    if (when === "turn_end") armedBypass.clear();

    const asOf = opts?.asOf;
    const state = k.timeline.state();
    const fields = getFields();
    const granted: string[] = [];
    const eventDrafts: EventDraft[] = [];
    const ctx = celCtx(undefined, asOf);
    const stamp = eventTime(asOf);

    const recentEvents = k.timeline.events().slice(-200);

    const sceneMinutes = k.authored.world.calendar.sceneMinutes;
    const turnMinutes = k.authored.world.calendar.turnMinutes;
    const now = toMinutes(asOf ?? state.time);

    for (const anchor of k.authored.anchors) {
      const st = activeAnchorStatus(state, anchor.id);
      if (isTerminal(st.status)) continue;

      if (anchorTargetMet(anchor, recentEvents, k.rules.cel, ctx)) {
        eventDrafts.push({ kind: "anchor.fulfilled", anchor: anchor.id, source: "director", ...(stamp ? { t: stamp } : {}) });
        continue;
      }

      const deadline = anchorDeadlineMinutes(anchor, k.rules.cel, ctx, toMinutes);
      if (deadline === undefined) continue;

      const scenesLeft = scenesUntilDeadline(deadline, now, sceneMinutes);
      const strategies = anchor.strategies;

      if (deadline <= now && strategies.includes("hard")) {
        eventDrafts.push({ kind: "anchor.fallback", anchor: anchor.id, source: "director", ...(stamp ? { t: stamp } : {}) });
        for (const d of anchor.hard) {
          eventDrafts.push({
            ...d,
            source: (d as { source?: string }).source ?? "director:anchor",
            ...(stamp ? { t: stamp } : {}),
          });
        }
        continue;
      }

      if (scenesLeft < 1 && scenesLeft > 0 && strategies.includes("soft") && st.status === "pending") {
        const soft = ensureSoftField(anchor);
        if (soft) {
          const entry = await fields.grant(soft, { source: "anchor", because: [anchor.id] });
          if (entry.kind === "field.granted") granted.push(soft.id);
        }
        eventDrafts.push({
          kind: "anchor.progress",
          anchor: anchor.id,
          stage: "soft",
          source: "director",
          ...(stamp ? { t: stamp } : {}),
        });
      }

      if (
        strategies.includes("force") &&
        isLastTurnBeforeDeadline(deadline, now, sceneMinutes, turnMinutes) &&
        st.status !== "forced" &&
        st.status !== "fulfilled"
      ) {
        const force = ensureForceField(anchor);
        if (force) {
          const entry = await fields.grant(force, { source: "anchor", because: [anchor.id] });
          if (entry.kind === "field.granted") granted.push(force.id);
          else k.warn("ANCHOR_FORCE_DENIED", `Force field for anchor ${anchor.id} was rejected`, { anchor: anchor.id });
        }
        eventDrafts.push({
          kind: "anchor.progress",
          anchor: anchor.id,
          stage: "force",
          source: "director",
          ...(stamp ? { t: stamp } : {}),
        });
      }

      if (deadline <= now && !anchorTargetMet(anchor, recentEvents, k.rules.cel, ctx) && st.status !== "fallback") {
        eventDrafts.push({
          kind: "anchor.progress",
          anchor: anchor.id,
          stage: "hard",
          source: "director",
          ...(stamp ? { t: stamp } : {}),
        });
      }
    }

    if (when === "scene_start" || when === "turn_start" || when === "time_advanced") {
      const beatState = state.beat.current;
      const beatResult = evaluateBeats(k.authored.beats, beatState, k.rules.cel, ctx);
      eventDrafts.push(
        ...beatResult.events.map((e) => ({ ...e, ...(stamp ? { t: stamp } : {}) })),
      );
      for (const fieldId of beatResult.enteredFields) {
        const def = k.authored.fields[fieldId];
        if (!def) continue;
        const beatField: FieldDef = { ...def, source: "runtime" };
        const entry = await fields.grant(beatField, { source: "beat", because: [beatResult.current ?? ""] });
        if (entry.kind === "field.granted") granted.push(def.id);
      }
    }

    const events: EngineEvent[] = eventDrafts.length ? await k.emit(eventDrafts, { source: "director" }) : [];
    const { nearest, near } = nearestAnchorMetrics();

    return {
      granted,
      events,
      nearestAnchorScenes: nearest,
      anchorNear: near,
    };
  }

  async function sidenote(npc: CharacterId, text: string, o?: { ttlTurns?: number; verbatim?: boolean }): Promise<void> {
    const noteId = `sn_${npc}_${k.timeline.state().seq + 1}`;
    await k.emit([
      {
        kind: "sidenote.added",
        npc,
        text,
        ttlTurns: o?.ttlTurns ?? 3,
        verbatim: o?.verbatim ?? false,
        noteId,
        source: "director",
      },
    ]);
  }

  function sidenotesFor(npc: CharacterId): { noteId: string; text: string; verbatim: boolean }[] {
    return k.timeline
      .state()
      .sidenotes.filter((n) => n.npc === npc)
      .map((n) => ({ noteId: n.noteId, text: n.text, verbatim: n.verbatim }));
  }

  async function afterRender(npc: CharacterId, generated: string): Promise<void> {
    const state = k.timeline.state();
    const drafts: EventDraft[] = [];
    for (const note of state.sidenotes.filter((n) => n.npc === npc)) {
      if (!note.verbatim && hasVerbatimEcho(note.text, generated)) {
        drafts.push({ kind: "sidenote.echoed", npc, noteId: note.noteId, source: "director" });
      }
      if (note.ttlTurns <= 0) {
        drafts.push({ kind: "sidenote.expired", npc, noteId: note.noteId, source: "director" });
      }
    }
    if (drafts.length) await k.emit(drafts, { source: "director" });
  }

  async function invokeException(id: string, target: string): Promise<LedgerEntry> {
    const def = k.authored.exceptions[id];
    if (!def) throw new Error(`Unknown exception ${id}`);
    if (!def.mayBypass.includes(target)) throw new Error(`Exception ${id} cannot bypass ${target}`);

    const periodKey = exceptionPeriodKey(def.period, k.timeline.now(), k.timeline.sessionId, k.authored);
    const used = k.timeline.state().exceptions[id]?.usedInPeriod ?? 0;
    const samePeriod = k.timeline.state().exceptions[id]?.periodKey === periodKey;
    const count = samePeriod ? used : 0;
    if (count >= def.charges) throw new Error(`Exception ${id} has no charges left`);

    const evs = await k.emit([{ kind: "exception.used", exceptionId: id, target, periodKey, source: "director" }]);
    armedBypass.add(target);
    const e = evs[0]!;
    return { eventId: e.id, kind: "exception.used", detail: { id, target, periodKey } };
  }

  function bypassArmed(what: string): boolean {
    return armedBypass.has(what);
  }

  return {
    tick,
    sidenote,
    sidenotesFor,
    afterRender,
    invokeException,
    bypassArmed,
    anchorsReferencing: (ref) => anchorsReferencing(ref, k.authored.anchors),
    beatNote: () => beatNote(k.authored.beats, k.timeline.state().beat.current),
  };
}

/** Uses `k.m.fields` when the kernel has wired modules (see engine bootstrap). */
export function createDirector(k: Kernel): Director {
  return createDirectorImpl(k, () => k.m.fields);
}
