import type { Kernel, WorldService } from "../contracts.ts";
import type { Duration, EngineEvent, EntityRef, EventDraft, WorldTime } from "../types.ts";
import { AnimaeError } from "../types.ts";
import { chapterAt, compareTime, dayBoundariesCrossed, formatTime, fromMinutes, toMinutes } from "./calendar.ts";
import { decayTicksForSpan } from "./decay.ts";
import { runDailyStageRules } from "./daily.ts";
import { runDeckDrawsForDay } from "./decks.ts";
import { catchUpEntity, fidelityForEntity } from "./offscreen.ts";
import { parseDurationMinutes } from "./duration.ts";
import {
  collectScheduledFires,
  draftsForScheduleFire,
  longEventPhaseDraftsInRange,
  type ScheduledFire,
} from "./schedule-run.ts";
import { validateWorldVar } from "./world-var-validate.ts";
import type { RuleCtx } from "../contracts.ts";
import { collectTimeAdvancedCheckpoints } from "../director/time-advanced-checkpoints.ts";

export type WorldServiceImpl = WorldService & {
  catchUpAll(): Promise<EngineEvent[]>;
};

export function createWorldService(k: Kernel): WorldServiceImpl {
  const calendar = () => k.authored.world.calendar;

  function now(): WorldTime {
    return { ...k.timeline.state().time };
  }

  function toMin(t: WorldTime): number {
    return toMinutes(t, calendar());
  }

  function fromMin(m: number): WorldTime {
    return fromMinutes(m, calendar());
  }

  function parseDuration(d: Duration): number {
    const cal = calendar();
    return parseDurationMinutes(d, cal.units.day, cal.units.hour);
  }

  function chapter(t?: WorldTime) {
    return chapterAt(t ?? now(), calendar());
  }

  function format(t: WorldTime) {
    return formatTime(t, calendar());
  }

  async function emitAll(drafts: EventDraft[]): Promise<EngineEvent[]> {
    if (drafts.length === 0) return [];
    return k.emit(drafts, { source: "world" });
  }

  async function runSchedule(from: WorldTime, to: WorldTime): Promise<EngineEvent[]> {
    if (compareTime(from, to, calendar()) >= 0) return [];
    const events: EngineEvent[] = [];
    const fires = collectScheduledFires(k, from, to);
    for (const fire of fires) {
      events.push(...(await emitAll(draftsForScheduleFire(k, fire))));
    }
    const phaseDrafts = longEventPhaseDraftsInRange(k, from, to);
    events.push(...(await emitAll(phaseDrafts)));
    return events;
  }

  type SpanMilestone =
    | { abs: number; kind: "schedule"; fire: ScheduledFire }
    | { abs: number; kind: "day" };

  async function processSpan(from: WorldTime, to: WorldTime): Promise<EngineEvent[]> {
    const all: EngineEvent[] = [];
    const cal = calendar();
    const fromM = toMin(from);
    const toM = toMin(to);
    if (toM <= fromM) return all;

    const milestones: SpanMilestone[] = [];
    for (const fire of collectScheduledFires(k, from, to)) {
      milestones.push({ abs: fire.absMinutes, kind: "schedule", fire });
    }
    for (const boundary of dayBoundariesCrossed(from, to, cal)) {
      milestones.push({ abs: boundary, kind: "day" });
    }
    milestones.sort((a, b) => a.abs - b.abs || (a.kind === "schedule" && b.kind === "day" ? -1 : 0));

    let cursorM = fromM;
    for (const ms of milestones) {
      if (ms.abs > cursorM) {
        const segFrom = fromMin(cursorM);
        const segTo = fromMin(ms.abs);
        all.push(...(await emitAll(decayTicksForSpan(k, segFrom, segTo))));
      }
      if (ms.kind === "schedule") {
        all.push(...(await emitAll(draftsForScheduleFire(k, ms.fire))));
      } else {
        const at = fromMin(ms.abs);
        all.push(...(await emitAll(runDailyStageRules(k, at))));
        all.push(...(await emitAll(runDeckDrawsForDay(k, at))));
        if (k.policy.memory.propagation?.enabled && k.policy.memory.propagation.onTick === "day") {
          all.push(...(await k.m.memory.propagateTick("day")));
        }
      }
      cursorM = ms.abs;
    }

    if (toM > cursorM) {
      all.push(...(await emitAll(decayTicksForSpan(k, fromMin(cursorM), to))));
    }

    const phaseDrafts = longEventPhaseDraftsInRange(k, from, to);
    all.push(...(await emitAll(phaseDrafts)));

    all.push(...(await k.m.introspect.expireGrants()));

    return all;
  }

  async function directorAfterTimeAdvanced(from: WorldTime, to: WorldTime): Promise<EngineEvent[]> {
    const fromM = toMin(from);
    const toM = toMin(to);
    const all: EngineEvent[] = [];
    for (const abs of collectTimeAdvancedCheckpoints(k, fromM, toM)) {
      const tick = await k.m.director.tick("time_advanced", { asOf: fromMin(abs) });
      all.push(...tick.events);
    }
    const final = await k.m.director.tick("time_advanced");
    all.push(...final.events);
    return all;
  }

  async function advance(by: Duration | { to: WorldTime }, reason?: string): Promise<EngineEvent[]> {
    const from = now();
    let to: WorldTime;
    if (typeof by === "object" && by !== null && "to" in by) {
      to = { ...by.to };
    } else {
      const mins = parseDuration(by as Duration);
      to = fromMin(toMin(from) + mins);
    }

    if (compareTime(to, from, calendar()) < 0) {
      throw new AnimaeError("TIME_BACKWARDS", "world.advance cannot move time backwards", { from, to });
    }
    if (compareTime(to, from, calendar()) === 0) {
      return [];
    }

    const spanEvents = await processSpan(from, to);
    const minutes = toMin(to) - toMin(from);
    const advanced = await emitAll([
      {
        kind: "time.advanced",
        from: { ...from },
        to: { ...to },
        minutes,
        reason,
        source: "world:advance",
      },
    ]);
    const anchorEvents = await directorAfterTimeAdvanced(from, to);

    return [...spanEvents, ...advanced, ...anchorEvents];
  }

  async function set(path: string, value: unknown): Promise<EngineEvent> {
    const trimmed = path.trim();
    if (!trimmed) throw new AnimaeError("WORLD_VAR_INVALID", "world.set path must be non-empty");
    validateWorldVar(trimmed, value, k.policy.schema?.extend?.world);
    const previous = k.timeline.state().vars[trimmed];
    const [ev] = await emitAll([
      { kind: "world.var_set", path: trimmed, value: value as import("../types.ts").JsonValue, previous, source: "world:set" },
    ]);
    if (!ev) throw new AnimaeError("EMIT_FAILED", "world.var_set did not persist");
    return ev;
  }

  async function move(who: string, location: string): Promise<EngineEvent> {
    if (!k.catalog.location(location)) {
      throw new AnimaeError("LOCATION_UNKNOWN", `unknown location "${location}"`, { location });
    }
    const c = k.timeline.state().characters[who];
    const from = c?.location;
    const [ev] = await emitAll([{ kind: "world.moved", who, from, to: location, source: "world:move" }]);
    if (!ev) throw new AnimaeError("EMIT_FAILED", "world.moved did not persist");
    return ev;
  }

  async function catchUp(entity: EntityRef): Promise<EngineEvent[]> {
    if (entity.kind !== "location" && entity.kind !== "character") {
      throw new AnimaeError("OFFSCREEN_ENTITY", "catchUp supports location and character entities only", { entity });
    }
    if (entity.kind === "location" && !k.catalog.location(entity.id)) {
      throw new AnimaeError("LOCATION_UNKNOWN", `unknown location "${entity.id}"`);
    }
    if (entity.kind === "character" && !k.catalog.character(entity.id)) {
      throw new AnimaeError("CHARACTER_UNKNOWN", `unknown character "${entity.id}"`);
    }

    const fidelity = fidelityForEntity(k, entity);
    if (fidelity === "none") return [];

    const out: EngineEvent[] = [];
    const drafts = await catchUpEntity(k, entity);
    out.push(...(await emitAll(drafts)));
    return out;
  }

  async function catchUpAll(): Promise<EngineEvent[]> {
    const out: EngineEvent[] = [];
    for (const loc of k.catalog.locations()) {
      out.push(...(await catchUp({ kind: "location", id: loc.id })));
    }
    for (const ch of k.catalog.characters()) {
      out.push(...(await catchUp({ kind: "character", id: ch.id })));
    }
    return out;
  }

  async function interruptLongEvent(id: string): Promise<EngineEvent[]> {
    const item = k.authored.schedule.find((s) => s.id === id);
    if (!item) throw new AnimaeError("SCHEDULE_UNKNOWN", `no schedule item "${id}"`);
    const st = k.timeline.state().schedule[id];
    if (!st?.startedAt || st.interrupted) return [];

    const out: EventDraft[] = [];
    if (item.onInterrupt) {
      const fn = k.rules.fn(item.onInterrupt);
      if (fn) {
        const ctx: RuleCtx = {
          stage: "tick",
          state: k.timeline.state(),
          authored: k.authored,
          policy: k.policy,
          time: now(),
          vars: k.celContext({ extra: { schedule: { id } } }),
          rng: () => k.timeline.rng(`longevent:interrupt:${id}`).next(),
        };
        out.push(...fn(ctx));
      } else {
        k.warn("RULE_MISSING", `onInterrupt rule "${item.onInterrupt}" not found`, { id });
      }
    }
    out.push({ kind: "longevent.interrupted", id, source: `schedule:${id}` });
    return emitAll(out);
  }

  return {
    now,
    advance,
    set,
    move,
    runSchedule,
    catchUp,
    catchUpAll,
    interruptLongEvent,
    chapter,
    format,
    toMinutes: toMin,
    fromMinutes: fromMin,
    parseDuration,
  };
}

export { fidelityForEntity };
