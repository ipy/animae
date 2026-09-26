import type { Kernel } from "../contracts.ts";
import { entityDisplayName } from "../entities/names.ts";
import { getPromptSection } from "../prompts/index.ts";
import type { TrackDef } from "../schema/policy.ts";
import type { CharacterId } from "../types.ts";
import { prepareAuthoredProse } from "./prompt-prose.ts";
import { policyText, prettifyId } from "./policy-labels.ts";

export function trackLabel(k: Kernel, trackId: string): string {
  const def = k.policy.tracks[trackId];
  return policyText(k, "track", trackId, "label", def?.label) || prettifyId(trackId);
}

export function tierLabel(k: Kernel, trackId: string, tierName: string): string {
  const tier = k.policy.tracks[trackId]?.tiers?.find((t) => t.name === tierName);
  return policyText(k, "tier", tierName, "label", tier?.label, trackId) || prettifyId(tierName);
}

/** Sentence-final punctuation (Latin and fullwidth) stripped so joined directives never read as `.;`. */
const TRAILING_SENTENCE_PUNCT = /[\s.;:,!?\u3002\uff1b\uff1a\uff0c\uff01\uff1f]+$/u;

/** Tier names in ascending threshold order. */
function sortedTierNames(def: TrackDef): string[] {
  return [...def.tiers].sort((a, b) => a.from - b.from).map((t) => t.name);
}

/** Name of the tier a track starts in (the one holding `initial`): it carries no news until the track moves. */
function baselineTierName(def: TrackDef): string | undefined {
  let name: string | undefined;
  for (const t of [...def.tiers].sort((a, b) => a.from - b.from)) {
    if (t.from <= def.initial) name = t.name;
  }
  return name;
}

/** How many tiers the current tier is away from the baseline tier (0 when at baseline or unknown). */
function tierShift(def: TrackDef, tierName: string): number {
  const names = sortedTierNames(def);
  const base = baselineTierName(def);
  const at = names.indexOf(tierName);
  const from = base ? names.indexOf(base) : -1;
  return at < 0 || from < 0 ? 0 : Math.abs(at - from);
}

/** Tier names left out of the compact line: `render.relation.silentTiers[track]` when set, else the baseline tier. */
function silentTierNames(k: Kernel, trackId: string): readonly string[] {
  const configured = k.policy.render.relation?.silentTiers?.[trackId];
  if (configured) return configured;
  const def = k.policy.tracks[trackId];
  const base = def ? baselineTierName(def) : undefined;
  return base ? [base] : [];
}

/** Relation-scope track ids in the order the game wants them shown (`render.relation.tracks`, else policy order). */
function relationTrackOrder(k: Kernel): string[] {
  const configured = k.policy.render.relation?.tracks;
  if (configured?.length) return configured;
  return Object.entries(k.policy.tracks)
    .filter(([, def]) => def.scope === "relation")
    .map(([id]) => id);
}

/**
 * Behavioral directives (`x.tier_directives`) for the speaker's current tiers toward `pid`. Tracks that moved furthest
 * from their starting tier win; ties keep the configured order, so a fresh relationship reads the same every time.
 */
function behaviorDirectives(k: Kernel, speaker: CharacterId, pid: CharacterId): string[] {
  const directives = k.policy.x?.tier_directives as Record<string, Record<string, string>> | undefined;
  if (!directives) return [];
  const toward = k.timeline.state().characters[speaker]?.tiers.toward[pid] ?? {};
  const relation = k.policy.render.relation;
  const order = relation?.directiveTracks ?? relationTrackOrder(k);
  const candidates: { line: string; shift: number; index: number }[] = [];
  order.forEach((trackId, index) => {
    const tierName = toward[trackId];
    const raw = tierName ? directives[trackId]?.[tierName] : undefined;
    const def = k.policy.tracks[trackId];
    if (!raw || !def) return;
    const line = prepareAuthoredProse(k, raw, { viewer: speaker, speaker }).replace(TRAILING_SENTENCE_PUNCT, "");
    candidates.push({ line, shift: tierShift(def, tierName!), index });
  });
  candidates.sort((a, b) => b.shift - a.shift || a.index - b.index);
  return candidates
    .slice(0, relation?.maxDirectives ?? 1)
    .map((c) => c.line)
    .filter(Boolean);
}

function relationKindSuffix(k: Kernel, speaker: CharacterId, pid: CharacterId): string {
  const rel = k.catalog.character(speaker)?.relations.find((r) => r.to === pid);
  if (!rel?.kind) return "";
  const kind = prepareAuthoredProse(k, rel.kind, { viewer: speaker, speaker });
  return kind ? getPromptSection(k.i18n.promptLocale, "relation_kind_paren", { kind }) : "";
}

/** One compact relation line toward another participant (display names + localized track/tier labels). */
export function compactRelationLine(k: Kernel, speaker: CharacterId, pid: CharacterId): string {
  const st = k.timeline.state().characters[speaker];
  const toward = st?.tiers.toward[pid] ?? {};
  const maxTracks = k.policy.render.relation?.maxTracks ?? 3;

  const tierParts: string[] = [];
  for (const trackId of relationTrackOrder(k)) {
    if (tierParts.length >= maxTracks) break;
    const def = k.policy.tracks[trackId];
    if (!def || def.scope !== "relation") continue;
    const tierName = toward[trackId];
    if (!tierName || silentTierNames(k, trackId).includes(tierName)) continue;
    tierParts.push(`${trackLabel(k, trackId)} ${tierLabel(k, trackId, tierName)}`);
  }

  const targetName = entityDisplayName(k.timeline.state(), k.catalog, pid, { viewer: speaker, speaker });
  const kindSuffix = relationKindSuffix(k, speaker, pid);
  const loc = k.i18n.promptLocale;
  const tierJoined = tierParts.join(getPromptSection(loc, "relation_tier_sep"));
  const tiers = tierJoined ? getPromptSection(loc, "relation_tiers_prefix", { tiers: tierJoined }) : "";
  const behavior = behaviorDirectives(k, speaker, pid).join(getPromptSection(loc, "relation_directive_sep"));
  const behaviorSuffix = behavior ? getPromptSection(loc, "relation_behavior_suffix", { text: behavior }) : "";

  return getPromptSection(loc, "relation_toward", {
    name: targetName,
    kindSuffix,
    tiers,
    behaviorSuffix,
  });
}
