import { z } from "zod";
import type { Kernel } from "../contracts.ts";
import { modelErrorContext, ruleModelOf, s2SpecOf, tiersOf } from "../model/select.ts";
import { locationVar } from "../rule-backend/location.ts";
import { resolveModelTimeoutMs } from "../model/timeout.ts";
import { buildCallContext, EMPTY_SEGMENTS } from "../pipeline/call-context.ts";
import { rethrowPipelineModelError } from "../pipeline/model-error.ts";
import { s2MaxOutputTokens } from "../router/policy-access.ts";
import { withRuleFallback } from "../runtime/fallback.ts";
import type { EntityRef, EventDraft, WorldTime } from "../types.ts";
import { compareTime } from "./calendar.ts";
import { parseAtTime } from "./schedule-parse.ts";
import { buildNarrateLocationPrompt } from "./narrate-prompt.ts";

const NarrateSchema = z.strictObject({ text: z.string() });

export function fidelityForEntity(
  k: Kernel,
  entity: EntityRef,
): "none" | "rule" | "narrate" | "full" {
  const f = k.policy.offscreen.fidelity;
  if (entity.kind === "location") return f.locations[entity.id] ?? f.default;
  if (entity.kind === "character") return f.characters[entity.id] ?? f.default;
  return f.default;
}

export async function catchUpEntity(k: Kernel, entity: EntityRef): Promise<EventDraft[]> {
  const state = k.timeline.state();
  const now = state.time;
  const from = lastSimulated(state, entity);
  if (!from) return [];
  if (compareTime(from, now, k.authored.world.calendar) >= 0) return [];

  const fidelity = fidelityForEntity(k, entity);
  if (fidelity === "none") return [];

  const out: EventDraft[] = [];

  if (fidelity === "narrate" || fidelity === "full") {
    const allow = k.m.router.allow("offscreen_narrate");
    out.push(...allow.events);
    if (allow.ok && entity.kind === "location") {
      const text = await narrateLocation(k, entity.id, allow.tier, (d) => out.push(d));
      if (text) {
        const path = `artifacts/_offscreen/${entity.id}.jsonl`;
        await k.timeline.artifacts.appendJsonl(path, { t: now, text, location: entity.id });
      }
    }
  }

  if (fidelity === "full") {
    out.push(...(await fullOffscreenEncounters(k, entity, from, now)));
  }

  out.push({
    kind: "offscreen.simulated",
    entity,
    from: { ...from },
    to: { ...now },
    fidelity,
    source: "world:catchUp",
  });

  return out;
}

function lastSimulated(state: import("../state.ts").EngineState, entity: EntityRef): WorldTime | undefined {
  if (entity.kind === "location") return state.locations[entity.id]?.lastSimulated;
  if (entity.kind === "character") return state.characters[entity.id]?.lastSimulated;
  return undefined;
}

/**
 * Offscreen narration is free text: the S2 role. `tier` is the S2 tier the router allowed, or undefined when S2 is
 * served by the rule backend (`offscreen.narrateTemplate`; nothing is written when the policy has no template).
 */
async function narrateLocation(
  k: Kernel,
  locationId: string,
  tier: string | undefined,
  onFallback: (draft: EventDraft) => void,
): Promise<string | undefined> {
  const run = async (port: ReturnType<typeof ruleModelOf>, req: Parameters<typeof port.stream>[0]): Promise<string> => {
    let text = "";
    for await (const part of port.stream(req)) {
      if (part.type === "final") text = (part.value as { text?: string }).text ?? "";
    }
    return text;
  };

  const callRule = (): Promise<string> => {
    const loc = k.catalog.location(locationId);
    return run(ruleModelOf(k), {
      label: "narrate",
      purpose: "offscreen",
      segments: EMPTY_SEGMENTS,
      schema: NarrateSchema,
      maxOutputTokens: s2MaxOutputTokens(k.policy, tiersOf(k).defaultId),
      context: buildCallContext(k, {
        purpose: "offscreen",
        rngKey: `offscreen:${locationId}:${k.timeline.state().time.day}:${k.timeline.state().time.minute}`,
        extra: { location: locationVar(k, locationId) },
      }),
    });
  };

  const callModel = async (): Promise<string> => {
    if (tier === undefined) return callRule();
    try {
      return await run(tiersOf(k).get(tier)?.port ?? k.models.s2, {
        label: "narrate",
        purpose: "offscreen",
        segments: buildNarrateLocationPrompt(k, locationId),
        schema: NarrateSchema,
        maxOutputTokens: s2MaxOutputTokens(k.policy, tier),
      });
    } catch (err) {
      rethrowPipelineModelError(
        err,
        "OFFSCREEN_NARRATE_FAILED",
        "Offscreen narration model call failed",
        modelErrorContext(s2SpecOf(k, tier), resolveModelTimeoutMs),
      );
    }
  };

  try {
    const text =
      tier === undefined
        ? await callRule()
        : (await withRuleFallback(k, "offscreen", "world:offscreen", callModel, callRule, onFallback)).value;
    return text.trim() || undefined;
  } catch (e) {
    k.warn("OFFSCREEN_NARRATE_FAILED", String(e), { location: locationId });
    return undefined;
  }
}

async function fullOffscreenEncounters(
  k: Kernel,
  entity: EntityRef,
  from: WorldTime,
  to: WorldTime,
): Promise<EventDraft[]> {
  const out: EventDraft[] = [];
  const locationId = entity.kind === "location" ? entity.id : undefined;

  for (const item of k.authored.schedule) {
    if (!item.characters?.length || !item.location) continue;
    if (locationId && item.location !== locationId) continue;

    const overlap = scheduleOverlapsSpan(k, item, from, to);
    if (!overlap) continue;

    for (const cid of item.characters) {
      const path = `artifacts/_offscreen/encounter_${item.id}_${cid}.jsonl`;
      const line = { t: to, scheduleId: item.id, characters: item.characters, location: item.location, span: { from, to } };
      await k.timeline.artifacts.appendJsonl(path, line);

      const mem = await k.m.memory.write(cid, {
        t: to,
        kind: "episodic",
        text: `Offscreen encounter at ${item.location} (${item.id}).`,
        tags: ["offscreen"],
        claims: [],
        importance: 0.4,
        valence: 0,
      });
      if (mem) {
        out.push({
          kind: "memory.written",
          owner: cid,
          memoryId: mem.id,
          importance: mem.importance,
          path: `artifacts/memory/${cid}/${mem.id}.json`,
          source: "world:offscreen",
        } as EventDraft & { kind: "memory.written" });
      }
    }
  }

  return out;
}

function scheduleOverlapsSpan(k: Kernel, item: import("../schema/authored.ts").ScheduleItem, from: WorldTime, to: WorldTime): boolean {
  if (item.at) {
    const at = parseAtTime(item.at, k.authored.world.calendar);
    const cmp = compareTime(from, at, k.authored.world.calendar);
    const cmp2 = compareTime(at, to, k.authored.world.calendar);
    return cmp < 0 && cmp2 <= 0;
  }
  return true;
}
