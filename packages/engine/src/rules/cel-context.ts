import type { Catalog } from "../contracts.ts";
import { entityDisplayName } from "../entities/names.ts";
import type { Appraisal } from "../events.ts";
import type { Authored, FieldEffects } from "../schema/authored.ts";
import type { ResolvedPolicy } from "../schema/policy.ts";
import type { EngineState, CharacterState } from "../state.ts";
import type { CelContext, CharacterId, SceneId, WorldTime } from "../types.ts";
import { aggregatedEventProb } from "../fields/caps.ts";
import { tierFor } from "./primitives.ts";

export interface BuildCelContextDeps {
  state: Readonly<EngineState>;
  authored: Readonly<Authored>;
  policy: Readonly<ResolvedPolicy>;
  catalog: Catalog;
  fieldEffects?: FieldEffects;
}

export interface BuildCelContextParams {
  self?: CharacterId;
  other?: CharacterId;
  actor?: CharacterId;
  event?: Partial<Appraisal> & { type?: string; text?: string; positive?: boolean };
  sceneId?: SceneId;
  check?: Record<string, unknown> | null;
  extra?: CelContext;
}

function charView(
  c: CharacterState | undefined,
  catalog: Catalog,
  id: string | undefined,
  state: Readonly<EngineState>,
  opts?: { viewer?: CharacterId; speaker?: CharacterId },
) {
  if (!c || !id) return null;
  const def = catalog.character(id);
  const traits = (def?.traits ?? {}) as Record<string, unknown>;
  const hardBottomLineTags: string[] = [];
  if (def?.card?.constraints?.bottom_lines) {
    for (const bl of def.card.constraints.bottom_lines) {
      if (bl.hardness === "hard") for (const t of bl.tags) hardBottomLineTags.push(t);
    }
  }
  return {
    id: c.id,
    name: entityDisplayName(state, catalog, id, { viewer: opts?.viewer, speaker: opts?.speaker }),
    canonical_name: c.name,
    lod: c.lod,
    tags: c.tags,
    traits,
    vars: c.vars,
    interactions: c.interactions,
    location: c.location ?? null,
    hard_bottom_line_tags: hardBottomLineTags,
  };
}

function effectiveTrackValue(
  owner: CharacterState,
  track: string,
  target: CharacterId | undefined,
  def: ResolvedPolicy["tracks"][string],
  fieldEffects?: FieldEffects,
): number {
  let v: number;
  if (def.scope === "self") v = owner.tracks.self[track] ?? def.initial;
  else v = target ? (owner.tracks.toward[target]?.[track] ?? def.initial) : def.initial;
  const off = fieldEffects?.track_offset?.[track];
  if (typeof off === "number") v += off;
  return v;
}

function effectiveTierName(
  owner: CharacterState,
  track: string,
  target: CharacterId | undefined,
  def: ResolvedPolicy["tracks"][string],
  fieldEffects?: FieldEffects,
): string | null {
  const value = effectiveTrackValue(owner, track, target, def, fieldEffects);
  const stored =
    def.scope === "self"
      ? (owner.tiers.self[track] ?? null)
      : (target && owner.tiers.toward[target]?.[track]) ?? null;
  const { tier } = tierFor(value, def.tiers ?? [], stored, def.hysteresis ?? 0);
  if (!tier) return null;
  const shift = fieldEffects?.tier_shift?.[track] ?? 0;
  if (!shift || !def.tiers?.length) return tier;
  const sorted = [...def.tiers].sort((a, b) => a.from - b.from);
  const idx = sorted.findIndex((t) => t.name === tier);
  const next = sorted[Math.min(sorted.length - 1, Math.max(0, idx + shift))];
  return next?.name ?? tier;
}

function worldTimeView(t: WorldTime) {
  const minutes = (t.day - 1) * 1440 + t.minute;
  return { day: t.day, minute: t.minute, hour: Math.floor(t.minute / 60), minutes };
}

export function buildCelContext(deps: BuildCelContextDeps, params: BuildCelContextParams): CelContext {
  const { state, authored, policy, catalog, fieldEffects } = deps;
  const selfId = params.self;
  const otherId = params.other;
  const actorId = params.actor;
  const selfChar = selfId ? state.characters[selfId] : undefined;
  const otherChar = otherId ? state.characters[otherId] : undefined;
  const scene = params.sceneId ? state.scene : null;

  const tracks: Record<string, number> = {};
  const tiers: Record<string, string | null> = {};
  if (selfChar) {
    for (const [name, def] of Object.entries(policy.tracks)) {
      tracks[name] = effectiveTrackValue(selfChar, name, otherId, def, fieldEffects);
      tiers[name] = effectiveTierName(selfChar, name, otherId, def, fieldEffects);
    }
  }

  const ev = params.event ?? {};
  const eventType = ev.type ?? "other";
  const positive = policy.events.types[eventType]?.positive ?? false;

  const activeFields = Object.keys(state.fields);

  const ctx: CelContext = {
    self: charView(selfChar, catalog, selfId, state, { viewer: otherId, speaker: selfId }),
    other: charView(otherChar, catalog, otherId, state, { viewer: selfId, speaker: otherId }),
    actor: charView(actorId ? state.characters[actorId] : undefined, catalog, actorId, state, {
      viewer: otherId ?? selfId,
      speaker: actorId,
    }),
    event: {
      type: eventType,
      intensity: ev.intensity ?? 0,
      sincerity: ev.sincerity ?? 1,
      approach: ev.approach ?? "",
      tags: ev.tags ?? [],
      claims: ev.claims ?? [],
      input_class: ev.input_class ?? "normal",
      positive,
      text: ev.text ?? "",
    },
    scene: scene
      ? {
          id: scene.id,
          location: scene.location,
          participants: scene.participants,
          turn: scene.turn,
          first: scene.turn <= 1,
          count: scene.turn,
        }
      : { id: params.sceneId ?? null, location: null, participants: [], turn: 0, first: true, count: 0 },
    world: {
      vars: { ...(authored.world.vars as Record<string, unknown>), ...state.vars },
      time: worldTimeView(state.time),
      chapter: authored.world.calendar.chapters[0]?.id ?? null,
      location: state.playerLocation ?? null,
      minutes: worldTimeView(state.time).minutes,
    },
    time: worldTimeView(state.time),
    tracks,
    tiers,
    memory: { count: selfId ? (state.memoryIndex[selfId]?.count ?? 0) : 0 },
    fields: {
      active: activeFields,
      ...Object.fromEntries(activeFields.map((id) => [id, true])),
      event_prob: aggregatedEventProb(fieldEffects),
    },
    check: params.check ?? null,
    model: { kind: "", tags: [] as string[] },
    image: { tags: [] as string[] },
  };

  const extra = (params.extra ?? {}) as Record<string, unknown>;
  const extraWorld = extra.world;
  const extraTime = extra.time;
  const extraModel = extra.model;
  const extraImage = extra.image;
  for (const [k, v] of Object.entries(extra)) {
    if (k === "world" || k === "time" || k === "model" || k === "image") continue;
    (ctx as Record<string, unknown>)[k] = v;
  }
  if (extraModel && typeof extraModel === "object" && !Array.isArray(extraModel)) {
    const m = extraModel as { kind?: string; tier?: string; tags?: string[] };
    ctx.model = {
      kind: typeof m.kind === "string" ? m.kind : "",
      ...(typeof m.tier === "string" ? { tier: m.tier } : {}),
      tags: Array.isArray(m.tags) ? [...m.tags] : [],
    };
  }
  if (extraImage && typeof extraImage === "object" && !Array.isArray(extraImage)) {
    const im = extraImage as { tags?: string[] };
    ctx.image = { tags: Array.isArray(im.tags) ? [...im.tags] : [] };
  }
  if (extraWorld && typeof extraWorld === "object" && !Array.isArray(extraWorld)) {
    const world = ctx.world as Record<string, unknown>;
    Object.assign(world, extraWorld as Record<string, unknown>);
    ctx.world = world;
  }
  if (extraTime && typeof extraTime === "object" && !Array.isArray(extraTime) && "day" in extraTime) {
    const tv = worldTimeView(extraTime as WorldTime);
    ctx.time = tv;
    const world = ctx.world as Record<string, unknown>;
    ctx.world = { ...world, time: tv, minutes: tv.minutes };
  }

  return ctx;
}
