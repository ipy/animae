import type { Kernel } from "../contracts.ts";
import { entityDisplayName } from "../entities/names.ts";
import { getPromptSection } from "../prompts/index.ts";
import type { PromptSegments } from "../ports.ts";
import type { CharacterId, EngineEvent, SceneId } from "../types.ts";
import { memorySyncList } from "./service.ts";
import { assembleBudgetSections, normalizePromptWhitespace } from "../pipeline/section-budget.ts";
import { prepareAuthoredProse } from "../pipeline/prompt-prose.ts";
import { displayLanguageName } from "../prompts/index.ts";
import { eventTypePromptLine } from "../pipeline/policy-labels.ts";
import { trackLabel as relationTrackLabel, tierLabel as relationTierLabel } from "../pipeline/relation-line.ts";

const DEFAULT_SKIP_KINDS = new Set([
  "track.delta",
  "time.advanced",
  "turn.ended",
  "turn.started",
  "budget.degraded",
  "route.decided",
  "input.classified",
  "offscreen.simulated",
  "scene.started",
]);

function skipEventKinds(k: Kernel): Set<string> {
  const extra = (k.policy.x?.reflection_skip_kinds as string[] | undefined) ?? [];
  return new Set([...DEFAULT_SKIP_KINDS, ...extra]);
}

function displayName(k: Kernel, id: string, viewer: CharacterId): string {
  return entityDisplayName(k.timeline.state(), k.catalog, id, { viewer, speaker: viewer });
}

function narrativeFromEvents(k: Kernel, sceneId: SceneId, owner: CharacterId, events: EngineEvent[]): string {
  const skip = skipEventKinds(k);
  const lines: string[] = [];
  let lastLine = "";
  for (const e of events) {
    if (skip.has(e.kind)) continue;
    if (e.kind === "utterance") {
      const u = e as { speaker?: string; text?: string; addressee?: string };
      const rawText = (u.text ?? "").trim();
      if (!rawText || rawText === "Listening." || rawText.length < 2) continue;
      const who = u.speaker ? displayName(k, u.speaker, owner) : "?";
      const to = u.addressee ? displayName(k, u.addressee, owner) : "";
      const tail = to ? getPromptSection(k.i18n.promptLocale, "reflect_utterance_to", { to, text: u.text ?? "" }) : (u.text ?? "");
      const line = getPromptSection(k.i18n.promptLocale, "reflect_utterance_line", { who, tail });
      if (line !== lastLine) {
        lines.push(line);
        lastLine = line;
      }
      continue;
    }
    if (e.kind === "tier.changed") {
      const t = e as { owner?: string; target?: string; track?: string; from?: string; to?: string };
      const who = t.owner ? displayName(k, t.owner, owner) : "";
      const toward = t.target ? displayName(k, t.target, owner) : "";
      const track = t.track ? relationTrackLabel(k, t.track) : "";
      const tier = t.track && t.to ? relationTierLabel(k, t.track, t.to) : t.to ?? "";
      const line = getPromptSection(k.i18n.promptLocale, "reflect_tier_changed", {
        who,
        toward,
        track,
        tier,
      });
      if (line !== lastLine) {
        lines.push(line);
        lastLine = line;
      }
      continue;
    }
    if (e.kind === "appraisal") {
      const a = e as { appraisal?: { type?: string } };
      const ctx = a.appraisal?.type ? eventTypePromptLine(k, a.appraisal.type) : "";
      if (ctx) {
        const line = getPromptSection(k.i18n.promptLocale, "reflect_appraisal", { context: ctx });
        if (line !== lastLine) {
          lines.push(line);
          lastLine = line;
        }
      }
      continue;
    }
    if (e.kind === "memory.written") {
      const m = e as { owner?: string; memoryId?: string };
      if (m.owner !== owner) continue;
      continue;
    }
    if (e.kind === "choice.taken" || e.kind === "choice.offered") continue;
    if (e.kind === "scene.ended" || e.kind === "scene.started") continue;
  }
  return lines.join("\n");
}

function reflectionStatic(k: Kernel, owner: CharacterId, lang: string): string {
  const def = k.catalog.character(owner);
  const loc = k.i18n.promptLocale;
  const display = displayName(k, owner, owner);
  const summaryRaw = def?.card.identity?.summary ? prepareAuthoredProse(k, def.card.identity.summary, { viewer: owner, speaker: owner }) : "";
  const summary = summaryRaw.replace(/[\u3002\uff0e.\uff0c,\s]+$/u, "");
  const identity = summary ? `${display} — ${summary}` : display;
  const outputLang = displayLanguageName(lang, loc);
  return getPromptSection(loc, "reflect_static", { identity, outputLang, tag: lang });
}

/** The owner's current goals with their ids, so a reflection can `update` or `remove` one instead of only adding. */
function currentGoals(k: Kernel, owner: CharacterId): string {
  const goals = k.timeline.state().characters[owner]?.goals ?? [];
  if (!goals.length) return "";
  const loc = k.i18n.promptLocale;
  const body = [...goals]
    .sort((a, b) => b.priority - a.priority)
    .map((g) =>
      getPromptSection(loc, "reflect_goal_line", {
        id: g.id,
        text: prepareAuthoredProse(k, g.text, { viewer: owner, speaker: owner }),
      }),
    )
    .join("\n");
  return getPromptSection(loc, "reflect_goals", { body });
}

function previousSummary(k: Kernel, owner: CharacterId): string {
  const entries = memorySyncList(k, owner);
  const summaries = entries.filter((e) => e.kind === "summary" || e.tags.includes("summary"));
  if (!summaries.length) return "";
  const text = prepareAuthoredProse(k, summaries[summaries.length - 1]!.text, { viewer: owner, speaker: owner });
  return getPromptSection(k.i18n.promptLocale, "reflect_previous_summary", { text });
}

/** Build section-aware reflection prompt segments (no raw JSON event dumps). */
export function buildReflectionPromptSegments(k: Kernel, sceneId: SceneId, owner: CharacterId): PromptSegments {
  const def = k.catalog.character(owner);
  const lang = def?.card.identity?.language ?? k.i18n.outputLocale ?? k.authored.world.language ?? "en";
  const sceneEvents = k.timeline.events().filter((e) => e.scene === sceneId);
  const narrative = narrativeFromEvents(k, sceneId, owner, sceneEvents);
  const prev = previousSummary(k, owner);

  const started = [...k.timeline.events()]
    .reverse()
    .find((e) => e.kind === "scene.started" && ((e as { sceneId?: string }).sceneId === sceneId || e.scene === sceneId)) as
    | { location?: string }
    | undefined;
  const loc = started?.location ? k.catalog.location(started.location) : undefined;
  const locName = loc ? prepareAuthoredProse(k, loc.name, { viewer: owner, speaker: owner }) : "";

  const ploc = k.i18n.promptLocale;
  const sections = [
    { id: "prev", priority: 90, text: prev },
    { id: "goals", priority: 85, text: currentGoals(k, owner) },
    { id: "scene", priority: 80, text: locName ? getPromptSection(ploc, "reflect_scene_place", { place: locName }) : "" },
    { id: "narrative", priority: 70, text: narrative ? getPromptSection(ploc, "reflect_scene_narrative", { body: narrative }) : "" },
  ];
  const { text: dynamic } = assembleBudgetSections(sections, k.policy.render.maxSegmentChars?.dynamic ?? 2400);

  return {
    static: normalizePromptWhitespace(reflectionStatic(k, owner, lang)),
    semiStatic: "",
    dynamic: normalizePromptWhitespace(dynamic),
    user: getPromptSection(k.i18n.promptLocale, "reflect_user"),
  };
}
