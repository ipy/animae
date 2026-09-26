import type { Kernel } from "../contracts.ts";
import { expandNameRefs } from "../entities/name-refs.ts";
import { authoredFieldPlain, entityDisplayName } from "../entities/names.ts";
import { displayLanguageName, getPromptSection, type PromptSectionKey } from "../prompts/index.ts";
import type { PromptSegments } from "../ports.ts";
import type { KnowledgeDoc } from "../schema/authored.ts";
import type { CharacterId } from "../types.ts";
import { memorySyncList } from "../memory/service.ts";
import { routerBudgetK } from "../router/policy-access.ts";
import type { PromptInput } from "./types.ts";
import { modelCelExtra } from "./model-cel.ts";
import { historyToMessages } from "./history.ts";
import { promptText } from "./prompt-text.ts";
import { prepareAuthoredProse } from "./prompt-prose.ts";
import { assembleBudgetSections, normalizePromptWhitespace, trimAtBoundary, type BudgetSection } from "./section-budget.ts";
import { segmentMetrics } from "./segment-utils.ts";
import { compactRelationLine } from "./relation-line.ts";
import { eventTypePromptLine, intentPromptLabel, policyText } from "./policy-labels.ts";

function lines(...parts: (string | undefined | false)[]): string {
  return parts.filter(Boolean).join("\n\n");
}

function expandPromptTemplateVars(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_, key: string) => vars[key] ?? "");
}

function policyPromptBlock(k: Kernel, key: string, vars?: Record<string, string>): string {
  const prompt = k.policy.x?.prompt;
  if (!prompt || typeof prompt !== "object") return "";
  const v = (prompt as Record<string, unknown>)[key];
  if (typeof v !== "string" || !v.trim()) return "";
  const raw = prepareAuthoredProse(k, v.trim());
  return vars ? expandPromptTemplateVars(raw, vars) : raw;
}

function templatePartialGuidance(k: Kernel): string {
  const prompt = k.policy.x?.prompt;
  if (!prompt || typeof prompt !== "object") return "";
  const ids = (prompt as { template_partials?: unknown }).template_partials;
  if (!Array.isArray(ids) || ids.length === 0) return "";
  const parts: string[] = [];
  for (const raw of [...ids].sort()) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    const tpl = k.authored.templates.character[raw.trim()];
    const g = tpl?.guidance?.trim();
    if (g) parts.push(prepareAuthoredProse(k, g));
  }
  return parts.length ? parts.join("\n\n") : "";
}

function outputLanguage(k: Kernel, speaker: CharacterId, override?: string): string {
  if (override) return override;
  if (k.i18n.outputLocale) return k.i18n.outputLocale;
  const def = k.catalog.character(speaker);
  return def?.card.identity?.language ?? k.authored.world.language ?? "en";
}

function promptLocale(k: Kernel): string {
  return k.i18n.promptLocale;
}

function languageOf(tag: string): string {
  return tag.toLowerCase().split(/[-_]/)[0] ?? tag.toLowerCase();
}

function speakerName(k: Kernel, i: PromptInput): string {
  return entityDisplayName(k.timeline.state(), k.catalog, i.speaker, { viewer: i.addressee, speaker: i.speaker });
}

function displayName(k: Kernel, id: CharacterId, viewer?: CharacterId, speaker?: CharacterId): string {
  return entityDisplayName(k.timeline.state(), k.catalog, id, { viewer, speaker });
}

function styleExamplesHeader(k: Kernel, lang: string): string {
  if (languageOf(lang) === languageOf(k.i18n.contentLocale)) {
    return getPromptSection(promptLocale(k), "heading_style_examples");
  }
  const from = displayLanguageName(k.i18n.contentLocale, promptLocale(k));
  return getPromptSection(promptLocale(k), "style_examples_cross", { from, tag: lang });
}

function nameGlossary(k: Kernel, i: PromptInput, lang: string): string {
  const content = k.i18n.contentLocale;
  if (languageOf(lang) === languageOf(content)) return "";
  const ids = [...new Set([i.speaker, i.addressee, ...i.scene.participants])].sort();
  const rows = new Map<string, string>();
  for (const id of ids) {
    if (k.timeline.state().aliases?.[id]?.nickname?.label) continue;
    const sourceName = displayName(k, id, i.speaker, i.speaker);
    // The row must translate the label that is actually shown: the card's nickname when it has one, else its name.
    const identity = k.catalog.character(id)?.card?.identity;
    const field = authoredFieldPlain(identity?.nickname) ? "nickname" : "name";
    const target = k.displayText?.lookup(lang, `character.${id}.${field}`);
    if (!target || target === sourceName) continue;
    if (!rows.has(sourceName)) rows.set(sourceName, target);
  }
  if (rows.size === 0) return "";
  const list = [...rows].map(([from, to]) => `- ${from} → ${to}`).join("\n");
  return getPromptSection(promptLocale(k), "name_glossary", { tag: lang, rows: list });
}

function tierLengthHint(k: Kernel, tier: PromptInput["tier"]): string {
  const budget = routerBudgetK(k).maxOutputTokens;
  const max = tier === "s2" ? budget.s2 : budget.s1;
  const loc = promptLocale(k);
  if (tier === "s2") return getPromptSection(loc, "tier_s2", { max });
  return getPromptSection(loc, "tier_s1", { max });
}

function formatCueSpec(k: Kernel): string {
  const types = k.policy.cues.types;
  const keys = Object.keys(types).sort();
  if (keys.length === 0) return getPromptSection(promptLocale(k), "cues_none");
  const loc = promptLocale(k);
  const rows = keys.map((name) => {
    const t = types[name]!;
    const argKeys = Object.keys(t.args ?? {}).sort().join(", ");
    const description = promptText(k, t.description);
    return `- ${name}${description ? `: ${description}` : ""}${argKeys ? ` (args: ${argKeys})` : ""}`;
  });
  return lines(getPromptSection(loc, "cues_header"), rows.join("\n"));
}

function formatChoicesBlock(k: Kernel): string {
  if (!k.policy.choices.enabled) return getPromptSection(promptLocale(k), "choices_disabled");
  const tags = (k.policy.x?.tag_vocabulary as string[] | undefined)?.filter(Boolean) ?? [];
  const loc = promptLocale(k);
  const tagsHint = [tags.length ? getPromptSection(loc, "choices_prefer_tags", { list: tags.join(", ") }) : "", policyPromptBlock(k, "choices")]
    .filter(Boolean)
    .join("\n");
  const eventTypes = Object.keys(k.policy.events.types).filter((t) => t !== "other").join(", ");
  return getPromptSection(loc, "choices_enabled", { count: k.policy.choices.count, eventTypes, tagsHint });
}

function mergedOutputContract(k: Kernel, lang: string, purpose: PromptInput["purpose"]): string {
  if (purpose === "appraise") return "";
  const loc = promptLocale(k);
  const outputLang = displayLanguageName(lang, loc);
  return getPromptSection(loc, "output_contract", {
    tag: lang,
    outputLang,
    cuesBlock: formatCueSpec(k),
    choicesBlock: formatChoicesBlock(k),
  });
}

function knowledgeDocBlock(k: Kernel, d: KnowledgeDoc): string {
  const body = prepareAuthoredProse(k, d.body);
  if (!body) return "";
  const name = prepareAuthoredProse(k, d.name);
  return `## ${name}\n${body}`;
}

/** A headed list that degrades item by item under the segment budget (items are ordered most important first). */
function listSection(id: string, priority: number, heading: string, items: string[], itemSep: string): BudgetSection {
  const compose = (kept: string[]) => lines(heading, kept.join(itemSep));
  return { id, priority, text: compose(items), items: { list: items, compose } };
}

function budgetAlwaysDocs(docs: KnowledgeDoc[], maxChars: number | undefined, k: Kernel): KnowledgeDoc[] {
  if (!maxChars || docs.length === 0) return docs;
  const sorted = [...docs].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  const out: KnowledgeDoc[] = [];
  let used = 0;
  for (const d of sorted) {
    const block = knowledgeDocBlock(k, d);
    if (!block) continue;
    if (used + block.length <= maxChars) {
      out.push(d);
      used += block.length + 2;
      continue;
    }
    break;
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

function unlockedSecretsText(k: Kernel, speaker: CharacterId): string {
  const def = k.catalog.character(speaker);
  const st = k.timeline.state().characters[speaker];
  if (!def || !st) return "";
  const unlocked = def.secrets
    .filter((s) => st.unlockedSecrets.includes(s.id))
    .sort((a, b) => a.id.localeCompare(b.id));
  if (unlocked.length === 0) return "";
  const head = getPromptSection(promptLocale(k), "heading_secrets");
  return lines(head, unlocked.map((s) => `- ${prepareAuthoredProse(k, s.text)}`).join("\n"));
}

function syncMemorySummary(k: Kernel, owner: CharacterId): string {
  const entries = memorySyncList(k, owner);
  const summaries = entries.filter((e) => e.kind === "summary" || e.tags.includes("summary"));
  const top = entries
    .filter((e) => e.kind !== "summary")
    .sort((a, b) => b.importance - a.importance || b.t.day - a.t.day)
    .slice(0, 5);
  const parts: string[] = [];
  if (summaries.length) parts.push(summaries.map((s) => prepareAuthoredProse(k, s.text)).join(" "));
  if (top.length) parts.push(top.map((m) => prepareAuthoredProse(k, m.text)).join(" "));
  return parts.join("\n").trim();
}

function relationSummary(k: Kernel, speaker: CharacterId, participants: CharacterId[]): string {
  const others = [...participants].filter((p) => p !== speaker).sort();
  if (!others.length) return "";
  const rows = others.map((pid) => compactRelationLine(k, speaker, pid));
  return lines(getPromptSection(promptLocale(k), "heading_relations"), rows.join("\n"));
}

function staticSegment(k: Kernel, i: PromptInput): { text: string; dropped: string[] } {
  const def = k.catalog.character(i.speaker);
  const lang = outputLanguage(k, i.speaker, i.outputLocale);
  const loc = promptLocale(k);
  const maxStatic = k.policy.render.maxSegmentChars?.static;

  const ctx = k.celContext({
    self: i.speaker,
    other: i.addressee,
    sceneId: i.scene.id,
    event: i.appraisal,
    extra: modelCelExtra(k, i.tier),
  });
  const inj = k.m.memory.knowledge({ owner: i.speaker, location: i.scene.location, sceneId: i.scene.id, ctx });
  const alwaysCap = maxStatic ? Math.floor(maxStatic * 0.28) : undefined;
  const alwaysDocs = budgetAlwaysDocs([...inj.always].sort((a, b) => a.id.localeCompare(b.id)), alwaysCap, k);

  const displayNameLine = speakerName(k, i);
  const identity = def?.card.identity;
  const canonical = identity?.name ? prepareAuthoredProse(k, identity.name) : def?.id ?? i.speaker;
  const summary = identity?.summary ? prepareAuthoredProse(k, identity.summary) : "";
  const nameForIdentity =
    displayNameLine !== canonical && canonical
      ? getPromptSection(promptLocale(k), "identity_canonical_paren", { display: displayNameLine, canonical })
      : displayNameLine;
  const identityLine = `${nameForIdentity}${summary ? ` — ${summary}` : ""}`;

  const constraints = def?.card.constraints;
  const bottomHard = (constraints?.bottom_lines ?? []).filter((b) => b.hardness === "hard").sort((a, b) => a.id.localeCompare(b.id));
  const bottomSoft = (constraints?.bottom_lines ?? []).filter((b) => b.hardness !== "hard").sort((a, b) => a.id.localeCompare(b.id));

  const promptVars = { name: displayNameLine, nickname: displayNameLine, canonical_name: canonical };
  // Template partials steer how the narration is written; the appraisal only classifies, so it stays without them.
  const partials = i.purpose === "render" ? templatePartialGuidance(k) : "";
  const renderExtra = i.purpose === "render" ? lines(nameGlossary(k, i, lang), policyPromptBlock(k, "render", promptVars)) : "";
  const appraiseExtra = i.purpose === "appraise" ? policyPromptBlock(k, "appraise_static", promptVars) : "";

  const sections: BudgetSection[] = [];

  if (i.purpose === "render" && def) {
    sections.push({
      id: "identity",
      priority: 100,
      text: getPromptSection(loc, "heading_identity", { identityLine }),
    });
    const persona = def.persona ? prepareAuthoredProse(k, def.persona) : "";
    if (persona) {
      sections.push({ id: "persona", priority: 95, text: lines(getPromptSection(loc, "heading_persona"), persona) });
    }
    if (def.card.style) {
      sections.push({
        id: "style",
        priority: 90,
        text: lines(getPromptSection(loc, "heading_style"), prepareAuthoredProse(k, def.card.style)),
      });
    }
    if ((identity?.style_examples?.length ?? 0) > 0) {
      const ex = identity!.style_examples!.map((x) => `- ${prepareAuthoredProse(k, x)}`).join("\n");
      sections.push({
        id: "style_examples",
        priority: 85,
        text: lines(styleExamplesHeader(k, lang), ex),
      });
    }
    if ((constraints?.motives?.length ?? 0) > 0) {
      sections.push({
        id: "motives",
        priority: 80,
        text: lines(getPromptSection(loc, "heading_motives"), constraints!.motives!.map((m) => prepareAuthoredProse(k, m)).join(getPromptSection(loc, "motives_sep"))),
      });
    }
    if (bottomHard.length) {
      sections.push({
        id: "hard_limits",
        priority: 78,
        text: lines(getPromptSection(loc, "heading_hard_limits"), bottomHard.map((b) => `- ${prepareAuthoredProse(k, b.text)}`).join("\n")),
      });
    }
    if (bottomSoft.length) {
      sections.push({
        id: "soft_limits",
        priority: 76,
        text: lines(getPromptSection(loc, "heading_soft_limits"), bottomSoft.map((b) => `- ${prepareAuthoredProse(k, b.text)}`).join("\n")),
      });
    }
    if ((constraints?.taboos?.length ?? 0) > 0) {
      // Taboos are tags: show the localized label when the game ships one (`taboo.<tag>.label`), else the tag as authored.
      const tabooItems = constraints!.taboos!
        .map((t) => policyText(k, "taboo", t, "label") || prepareAuthoredProse(k, t))
        .filter(Boolean);
      sections.push({
        id: "taboos",
        priority: 74,
        text: lines(getPromptSection(loc, "heading_taboos"), tabooItems.join(getPromptSection(loc, "taboos_sep"))),
      });
    }
  }

  if (i.extraStatic) sections.push({ id: "extra_static", priority: 95, text: prepareAuthoredProse(k, i.extraStatic) });
  if (i.purpose === "appraise") {
    sections.push({ id: "appraise_static", priority: 90, text: appraiseExtra });
  }

  const secrets = unlockedSecretsText(k, i.speaker);
  if (secrets) sections.push({ id: "secrets", priority: 70, text: secrets });

  const worldFacts =
    i.purpose === "appraise"
      ? ""
      : policyPromptBlock(k, "world_facts") || prepareAuthoredProse(k, k.authored.world.rules_text);
  if (worldFacts) {
    sections.push({
      id: "world_rules",
      priority: 65,
      text: lines(getPromptSection(loc, "heading_world_rules"), worldFacts),
    });
  }

  if (partials) {
    sections.push({
      id: "narrator_partials",
      priority: 60,
      text: lines(getPromptSection(loc, "heading_narrator_partials"), partials),
    });
  }

  if (renderExtra) sections.push({ id: "render_policy", priority: 55, text: renderExtra });

  const contract = mergedOutputContract(k, lang, i.purpose);
  if (contract) sections.push({ id: "output_contract", priority: 50, text: contract });

  if (alwaysDocs.length && i.purpose !== "appraise") {
    sections.push({
      id: "background_knowledge",
      priority: 40,
      text: lines(
        getPromptSection(loc, "heading_background_knowledge"),
        alwaysDocs.map((d) => knowledgeDocBlock(k, d)).join("\n\n"),
      ),
    });
  }

  const { text, dropped } = assembleBudgetSections(sections, maxStatic);
  return { text: normalizePromptWhitespace(text), dropped };
}

function knowledgeIndexMax(k: Kernel): number {
  const raw = (k.policy.render as { knowledgeIndexMax?: number }).knowledgeIndexMax;
  return typeof raw === "number" && raw > 0 ? raw : 12;
}

function semiStaticSegment(k: Kernel, i: PromptInput, attachedDocIds: Set<string>, showKnowledgeIndex: boolean): { text: string; dropped: string[] } {
  const loc = k.catalog.location(i.scene.location);
  const participants = [...i.scene.participants].sort();
  const ctx = k.celContext({
    self: i.speaker,
    other: i.addressee,
    sceneId: i.scene.id,
    event: i.appraisal,
    extra: modelCelExtra(k, i.tier),
  });
  const inj = k.m.memory.knowledge({ owner: i.speaker, location: i.scene.location, sceneId: i.scene.id, ctx });
  const indexCandidates = inj.index.filter((x) => !attachedDocIds.has(x.id)).slice(0, knowledgeIndexMax(k));
  const indexLoc = promptLocale(k);
  const indexLines = indexCandidates.map((x) => {
    const desc = prepareAuthoredProse(k, x.description);
    return getPromptSection(indexLoc, "knowledge_index_item", {
      name: prepareAuthoredProse(k, x.name),
      id: x.id,
      description: desc ? getPromptSection(indexLoc, "knowledge_index_description", { description: desc }) : "",
    });
  });

  const summary = syncMemorySummary(k, i.speaker);
  const beat = k.m.director.beatNote?.();
  const locName = loc ? prepareAuthoredProse(k, loc.name) || i.scene.location : i.scene.location;
  // The place's atmosphere steers narration; classifying what was said only needs to know where it was said.
  const locDesc =
    i.purpose !== "render"
      ? ""
      : loc?.description
        ? ` — ${prepareAuthoredProse(k, loc.description)}`
        : loc?.summary
          ? ` — ${prepareAuthoredProse(k, loc.summary)}`
          : "";
  const participantNames = participants.map((p) => displayName(k, p, i.speaker, i.speaker)).join(getPromptSection(promptLocale(k), "participants_sep"));

  const sections: BudgetSection[] = [
    { id: "relations", priority: 80, text: relationSummary(k, i.speaker, participants) },
    summary
      ? { id: "memory", priority: 70, text: lines(getPromptSection(promptLocale(k), "heading_memory"), summary) }
      : { id: "memory", priority: 70, text: "" },
    showKnowledgeIndex && indexLines.length
      ? listSection("knowledge_index", 45, getPromptSection(promptLocale(k), "heading_knowledge_index"), indexLines, "\n")
      : { id: "knowledge_index", priority: 45, text: "" },
    {
      id: "scene",
      priority: 65,
      text: lines(
        getPromptSection(promptLocale(k), "heading_scene"),
        getPromptSection(promptLocale(k), "scene_location", { locationName: locName, description: locDesc }),
        getPromptSection(promptLocale(k), "scene_participants", { names: participantNames }),
      ),
    },
    beat ? { id: "beat", priority: 50, text: beat } : { id: "beat", priority: 50, text: "" },
  ];

  const maxSemi = k.policy.render.maxSegmentChars?.semiStatic;
  const { text, dropped } = assembleBudgetSections(sections, maxSemi);
  return { text: normalizePromptWhitespace(text), dropped };
}

function fieldEffectsText(k: Kernel, fx: PromptInput["fieldEffects"]): string {
  const loc = promptLocale(k);
  const parts: string[] = [];
  if (fx.topic_access) {
    const { open = [], close = [] } = fx.topic_access;
    if (close.length) {
      parts.push(getPromptSection(loc, "field_topics_closed", { list: [...close].sort().join(", ") }));
    }
    if (open.length) {
      parts.push(getPromptSection(loc, "field_topics_open", { list: [...open].sort().join(", ") }));
    }
  }
  if (fx.salience?.length) {
    parts.push(
      getPromptSection(loc, "field_salience", {
        rows: fx.salience.map((s) => `${s.tags.join("+")}:${s.boost}`).join("; "),
      }),
    );
  }
  if (fx.world_vars && Object.keys(fx.world_vars).length) {
    const keys = Object.keys(fx.world_vars).sort();
    parts.push(
      getPromptSection(loc, "field_world_context", {
        rows: keys.map((key) => `${key}=${JSON.stringify(fx.world_vars![key])}`).join(", "),
      }),
    );
  }
  if (fx.intent_force) parts.push(getPromptSection(loc, "field_intent_force", { intent: fx.intent_force }));
  if (fx.intent_forbid?.length) {
    parts.push(getPromptSection(loc, "field_intent_forbid", { list: fx.intent_forbid.join(", ") }));
  }
  if (fx.intent_bias && Object.keys(fx.intent_bias).length) {
    parts.push(getPromptSection(loc, "field_intent_bias", { json: JSON.stringify(fx.intent_bias) }));
  }
  if (fx.hide_entities?.length) {
    const names = [...fx.hide_entities].sort().map((id) => displayName(k, id));
    parts.push(getPromptSection(loc, "field_hide_entities", { names: names.join(", ") }));
  }
  if (fx.disguise && Object.keys(fx.disguise).length) {
    parts.push(getPromptSection(loc, "field_disguise", { json: JSON.stringify(fx.disguise) }));
  }
  if (fx.inject_belief?.length) {
    parts.push(
      getPromptSection(loc, "field_inject_belief_header"),
      fx.inject_belief.map((b) => `- ${prepareAuthoredProse(k, b.text)}`).join("\n"),
    );
  }
  return parts.join("\n");
}

const DISTORTION_PHRASES = {
  intensify: "memory_distortion_intensify",
  swap_subject: "memory_distortion_swap_subject",
  add_motive: "memory_distortion_add_motive",
} as const satisfies Record<string, PromptSectionKey>;

function recallCaps(k: Kernel): { maxKnowledge: number; knowledgeChars: number; memoryChars: number } {
  const raw = (k.policy.render as { recall?: { maxKnowledge?: number; knowledgeChars?: number; memoryChars?: number } }).recall;
  return {
    maxKnowledge: raw?.maxKnowledge ?? 3,
    knowledgeChars: raw?.knowledgeChars ?? 280,
    memoryChars: raw?.memoryChars ?? 400,
  };
}

/** Phrase for how a hazy memory goes wrong, in the prompt language (falls back to the developer-facing text). */
function distortionPhrase(loc: string, hit: { distortion?: string; distortionKind?: string }): string {
  const key = hit.distortionKind ? DISTORTION_PHRASES[hit.distortionKind as keyof typeof DISTORTION_PHRASES] : undefined;
  return key ? getPromptSection(loc, key) : (hit.distortion ?? "");
}

/**
 * Recalled memories and knowledge, best first, as plain lines: the model needs the content, not retrieval
 * bookkeeping (ids, scores). Knowledge is capped in count and length so loosely related lore cannot crowd the turn,
 * and a document the prompt already carries in full (`shownDocIds`) is not repeated as a recalled excerpt.
 */
function recalledLines(k: Kernel, i: PromptInput, shownDocIds: ReadonlySet<string>): string[] {
  const loc = promptLocale(k);
  const caps = recallCaps(k);
  let knowledgeKept = 0;
  const out: string[] = [];
  const hits = (i.hits ?? []).slice().sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  for (const h of hits) {
    const hazy = h.distortion ? getPromptSection(loc, "memory_hit_hazy", { distortion: distortionPhrase(loc, h) }) : "";
    if (h.kind === "knowledge") {
      if (knowledgeKept >= caps.maxKnowledge) continue;
      knowledgeKept++;
      // A document already in the prompt used up its place among the best matches but is not printed twice.
      if (shownDocIds.has(h.doc?.id ?? h.id)) continue;
      const body = prepareAuthoredProse(k, h.text);
      const text = trimAtBoundary(body, caps.knowledgeChars);
      const more = i.tier === "s2" && text.length < body.length ? getPromptSection(loc, "recall_knowledge_more", { id: h.id }) : "";
      out.push(
        getPromptSection(loc, "recall_knowledge_item", {
          name: prepareAuthoredProse(k, h.doc?.name ?? h.id),
          text: `${hazy}${text}${more}`,
        }),
      );
      continue;
    }
    out.push(`- ${hazy}${trimAtBoundary(prepareAuthoredProse(k, h.text), caps.memoryChars)}`);
  }
  return out;
}

function dynamicSegment(
  k: Kernel,
  i: PromptInput,
  whenDocs: KnowledgeDoc[],
  attachedDocIds: Set<string>,
): { text: string; dropped: string[] } {
  const lengthHint = i.purpose === "render" && i.tier ? tierLengthHint(k, i.tier) : "";

  // Most important document first: when the budget is tight the lowest-priority documents are the ones omitted.
  // Contextual knowledge steers how the narration is written; the appraisal only classifies the player's line (and
  // runs before the event it would be conditioned on exists), so it goes without.
  const whenSorted =
    i.purpose === "render"
      ? [...whenDocs]
          .filter((d) => !attachedDocIds.has(d.id))
          .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
      : [];
  const whenBlocks = whenSorted.map((d) => knowledgeDocBlock(k, d)).filter(Boolean);

  const locDyn = promptLocale(k);
  const shownDocIds = new Set<string>([...attachedDocIds, ...whenSorted.map((d) => d.id)]);
  const hitLines = recalledLines(k, i, shownDocIds);

  const sidenotes = (i.sidenotes ?? [])
    .slice()
    .sort((a, b) => a.noteId.localeCompare(b.noteId))
    .map((n) => {
      const text = prepareAuthoredProse(k, n.text);
      return n.verbatim
        ? getPromptSection(locDyn, "sidenote_verbatim", { text })
        : getPromptSection(locDyn, "sidenote_brief", { text });
    });

  const intentBlock =
    i.intent &&
    getPromptSection(promptLocale(k), "intent_decided", {
      intentLabel: intentPromptLabel(k, i.intent.intent),
      intentId: i.intent.intent,
      forced: i.intent.forced ? getPromptSection(promptLocale(k), "intent_forced_suffix") : "",
    });

  const eventContext = i.appraisal?.type ? eventTypePromptLine(k, i.appraisal.type) : "";
  const appraiseHint =
    eventContext &&
    getPromptSection(promptLocale(k), "appraise_event_context", {
      context: eventContext,
      tagsSuffix: i.appraisal!.tags.length ? getPromptSection(promptLocale(k), "appraise_event_tags", { tags: i.appraisal!.tags.join(", ") }) : "",
    });

  const sections: BudgetSection[] = [
    { id: "tier_hint", priority: 60, text: lengthHint },
    { id: "field_effects", priority: 55, text: fieldEffectsText(k, i.fieldEffects) },
    whenBlocks.length
      ? listSection("contextual_knowledge", 50, getPromptSection(promptLocale(k), "heading_contextual_knowledge"), whenBlocks, "\n\n")
      : { id: "contextual_knowledge", priority: 50, text: "" },
    hitLines.length
      ? listSection("recalled", 45, getPromptSection(locDyn, "heading_recalled"), hitLines, "\n")
      : { id: "recalled", priority: 45, text: "" },
    sidenotes.length
      ? { id: "sidenotes", priority: 40, text: lines(getPromptSection(locDyn, "heading_sidenotes"), sidenotes.join("\n")) }
      : { id: "sidenotes", priority: 40, text: "" },
    intentBlock ? { id: "intent", priority: 70, text: intentBlock } : { id: "intent", priority: 70, text: "" },
    appraiseHint ? { id: "appraise_hint", priority: 35, text: appraiseHint } : { id: "appraise_hint", priority: 35, text: "" },
    i.extraDynamic ? { id: "extra", priority: 30, text: prepareAuthoredProse(k, i.extraDynamic) } : { id: "extra", priority: 30, text: "" },
  ];

  const maxDyn = k.policy.render.maxSegmentChars?.dynamic;
  const { text, dropped } = assembleBudgetSections(sections, maxDyn);
  return { text: normalizePromptWhitespace(text), dropped };
}

function formatDelimitedActorText(k: Kernel, actorText: string): string {
  const body = expandNameRefs(actorText, { state: k.timeline.state(), catalog: k.catalog });
  return getPromptSection(promptLocale(k), "appraise_actor_delimiter", { actorText: body });
}

/**
 * The output-language reminder written in the output language itself, placed last in the render user message. The
 * working prompt (persona, style examples) may be in another language and drags replies toward it; models weigh the
 * final instruction they read most. Empty when the working prompt already is in the output language.
 */
function outputLanguageReminder(k: Kernel, i: PromptInput): string {
  const tag = outputLanguage(k, i.speaker, i.outputLocale);
  if (languageOf(tag) === languageOf(promptLocale(k))) return "";
  return getPromptSection(tag, "render_user_language", { language: displayLanguageName(tag, tag), tag });
}

function userMessage(k: Kernel, i: PromptInput): string {
  if (i.purpose === "appraise") {
    return formatDelimitedActorText(k, i.actorText ?? "");
  }
  return lines(getPromptSection(promptLocale(k), "render_user", { name: speakerName(k, i) }), outputLanguageReminder(k, i));
}

/** Build prompt segments for the turn pipeline (deterministic ordering; see docs/pipeline-and-events.md). */
export function buildPromptSegments(k: Kernel, i: PromptInput): PromptSegments {
  const ctx = k.celContext({
    self: i.speaker,
    other: i.addressee,
    actor: i.addressee,
    event: i.appraisal,
    sceneId: i.scene.id,
    extra: modelCelExtra(k, i.tier),
  });
  const inj = k.m.memory.knowledge({ owner: i.speaker, location: i.scene.location, sceneId: i.scene.id, ctx });

  const attachedDocIds = new Set<string>();
  for (const d of inj.always) attachedDocIds.add(d.id);

  const staticBuilt = staticSegment(k, i);
  const showKnowledgeIndex = i.purpose === "render" && i.tier === "s2";
  const semiBuilt = semiStaticSegment(k, i, attachedDocIds, showKnowledgeIndex);
  const dynamicBuilt = dynamicSegment(k, i, inj.when, attachedDocIds);

  const droppedSections = [...staticBuilt.dropped, ...semiBuilt.dropped, ...dynamicBuilt.dropped];

  return {
    static: staticBuilt.text,
    semiStatic: semiBuilt.text,
    dynamic: dynamicBuilt.text,
    history: historyToMessages(i.history, {
      speaker: i.speaker,
      nameOf: (id) => entityDisplayName(k.timeline.state(), k.catalog, id),
    }),
    user: userMessage(k, i),
    diagnostics: droppedSections.length ? { droppedSections } : undefined,
  };
}

/** Segment size metrics for tuning (chars + ~tokens for CJK). */
export function measurePromptSegments(segments: PromptSegments): Record<string, { chars: number; tokensEst: number }> {
  const m = (s: string) => segmentMetrics(s);
  const hist = (segments.history ?? []).map((h) => h.content).join("\n");
  return {
    static: m(segments.static),
    semiStatic: m(segments.semiStatic),
    dynamic: m(segments.dynamic),
    history: m(hist),
    user: m(segments.user),
  };
}
