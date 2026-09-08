import type { Kernel } from "../contracts.ts";
import { createEngineI18n } from "../i18n/catalogs.ts";
import { displayLanguageName, getPromptSection } from "../prompts/index.ts";
import { entityDisplayName } from "../entities/names.ts";
import type { PromptSegments } from "../ports.ts";
import type { KnowledgeDoc } from "../schema/authored.ts";
import type { CharacterId } from "../types.ts";
import { memorySyncList } from "../memory/service.ts";
import { routerBudgetK } from "../router/policy-access.ts";
import type { PromptInput } from "./types.ts";
import { historyToMessages } from "./history.ts";
import { segmentMetrics, truncateToCharBudget } from "./segment-utils.ts";

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
  const raw = v.trim();
  return vars ? expandPromptTemplateVars(raw, vars) : raw;
}

/** Optional character template `guidance` blocks (sorted ids) from `policy.x.prompt.template_partials`. */
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
    if (g) parts.push(g);
  }
  return parts.length ? parts.join("\n\n") : "";
}

function outputLanguage(k: Kernel, speaker: CharacterId): string {
  const def = k.catalog.character(speaker);
  return def?.card.identity?.language ?? k.i18n.outputLocale ?? k.authored.world.language ?? "en";
}

function promptLocale(k: Kernel): string {
  return k.i18n.promptLocale;
}

function engineOutputRules(k: Kernel): string {
  return getPromptSection(promptLocale(k), "output_contract");
}

function renderTextConvention(k: Kernel): string {
  return getPromptSection(promptLocale(k), "render_text_field");
}

function intentRealizedRule(k: Kernel): string {
  return getPromptSection(promptLocale(k), "intent_realized");
}

function outputLanguageDirective(k: Kernel, tag: string): string {
  const ui = createEngineI18n(k.i18n.locale, [k.i18n.fallbackLocale]);
  const lang = displayLanguageName(tag, k.i18n.locale);
  return ui.t("diagnostics:output_language_directive", { language: lang, tag });
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
  const rows = keys.map((name) => {
    const t = types[name]!;
    const argKeys = Object.keys(t.args ?? {}).sort().join(", ");
    return `- ${name}${t.description ? `: ${t.description}` : ""}${argKeys ? ` (args: ${argKeys})` : ""}`;
  });
  return lines(getPromptSection(promptLocale(k), "cues_header"), rows.join("\n"));
}

function formatChoicesSpec(k: Kernel): string {
  if (!k.policy.choices.enabled) return getPromptSection(promptLocale(k), "choices_disabled");
  const game = policyPromptBlock(k, "choices");
  const tags = (k.policy.x?.tag_vocabulary as string[] | undefined)?.filter(Boolean) ?? [];
  return lines(
    getPromptSection(promptLocale(k), "choices_enabled", { count: k.policy.choices.count }),
    tags.length ? `Prefer tags from vocabulary: ${tags.join(", ")}` : "Use normalized lowercase tags from the game vocabulary.",
    "When matchmaking is a theme, include at least one choice that advances pairing or social setup when sensible.",
    game,
  );
}

function budgetAlwaysDocs(docs: KnowledgeDoc[], maxChars: number | undefined): KnowledgeDoc[] {
  if (!maxChars || docs.length === 0) return docs;
  const sorted = [...docs].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  const out: KnowledgeDoc[] = [];
  let used = 0;
  for (const d of sorted) {
    const body = d.body.trim();
    const block = `## ${d.name}\n${body}`;
    if (used + block.length <= maxChars) {
      out.push(d);
      used += block.length + 2;
      continue;
    }
    const remaining = maxChars - used;
    if (remaining > 80) {
      const trimmed = { ...d, body: truncateToCharBudget(body, remaining - d.name.length - 4) };
      out.push(trimmed);
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
  return lines(
    "Secrets you know (do not reveal to others unless in character):",
    unlocked.map((s) => `- [${s.id}] ${s.text}`).join("\n"),
  );
}

function syncMemorySummary(k: Kernel, owner: CharacterId): string {
  const entries = memorySyncList(k, owner);
  const summaries = entries.filter((e) => e.kind === "summary" || e.tags.includes("summary"));
  const top = entries
    .filter((e) => e.kind !== "summary")
    .sort((a, b) => b.importance - a.importance || b.t.day - a.t.day)
    .slice(0, 5);
  const parts: string[] = [];
  if (summaries.length) parts.push(summaries.map((s) => s.text).join(" "));
  if (top.length) parts.push(top.map((m) => m.text).join(" "));
  return parts.join("\n").trim();
}

function tierBehaviorDirectives(k: Kernel, speaker: CharacterId, addressee: CharacterId): string {
  const map = k.policy.x?.tier_directives as Record<string, Record<string, string>> | undefined;
  if (!map || !Object.keys(map).length) return "";
  const st = k.timeline.state().characters[speaker];
  if (!st) return "";
  const toward = st.tiers.toward[addressee] ?? {};
  const rows: string[] = [];
  for (const track of Object.keys(map).sort()) {
    const tierName = toward[track];
    if (!tierName) continue;
    const line = map[track]?.[tierName];
    if (line) rows.push(`- ${track} (${tierName}): ${line}`);
  }
  return rows.length ? lines("Relationship behavior (follow these, not raw numbers):", rows.join("\n")) : "";
}

function joinStaticSections(sectionTexts: (string | false | undefined)[], maxChars: number | undefined): string {
  const sections = sectionTexts.map((s) => (typeof s === "string" ? s.trim() : "")).filter(Boolean);
  if (!maxChars) return sections.join("\n\n");
  let out = "";
  for (const s of sections) {
    const candidate = out ? `${out}\n\n${s}` : s;
    if (candidate.length <= maxChars) {
      out = candidate;
      continue;
    }
    const remaining = maxChars - (out ? out.length + 2 : 0);
    if (remaining > 80) {
      const piece = truncateToCharBudget(s, remaining);
      out = out ? `${out}\n\n${piece}` : piece;
    }
    break;
  }
  return out;
}

function staticSegment(k: Kernel, i: PromptInput): string {
  const def = k.catalog.character(i.speaker);
  const lang = outputLanguage(k, i.speaker);
  const rules = k.authored.world.rules_text?.trim() ?? "";
  const identity = def?.card.identity;
  const constraints = def?.card.constraints;
  const bottomHard = (constraints?.bottom_lines ?? [])
    .filter((b) => b.hardness === "hard")
    .sort((a, b) => a.id.localeCompare(b.id));
  const bottomSoft = (constraints?.bottom_lines ?? [])
    .filter((b) => b.hardness !== "hard")
    .sort((a, b) => a.id.localeCompare(b.id));

  const ctx = k.celContext({ self: i.speaker, other: i.addressee, sceneId: i.scene.id });
  const inj = k.m.memory.knowledge({ owner: i.speaker, location: i.scene.location, sceneId: i.scene.id, ctx });
  const maxStatic = k.policy.render.maxSegmentChars?.static;
  const alwaysCap = maxStatic ? Math.floor(maxStatic * 0.32) : undefined;
  const alwaysDocs = budgetAlwaysDocs([...inj.always].sort((a, b) => a.id.localeCompare(b.id)), alwaysCap);
  const personaCap = maxStatic ? Math.floor(maxStatic * 0.26) : undefined;
  const personaBody = def?.persona?.trim();
  const personaBlock =
    personaBody && personaCap
      ? `Persona:\n${truncateToCharBudget(personaBody, personaCap - "Persona:\n".length)}`
      : personaBody
        ? `Persona:\n${personaBody}`
        : "";

  const partials = templatePartialGuidance(k);
  const displayName = entityDisplayName(k.timeline.state(), k.catalog, i.speaker, {
    viewer: i.addressee,
    speaker: i.speaker,
  });
  const promptVars = { name: displayName, nickname: displayName, canonical_name: identity?.name ?? def?.id ?? i.speaker };
  const renderExtra =
    i.purpose === "render"
      ? lines(
          renderTextConvention(k),
          intentRealizedRule(k),
          outputLanguageDirective(k, lang),
          partials && `Narrator partials:\n${partials}`,
          policyPromptBlock(k, "render", promptVars),
        )
      : "";
  const appraiseExtra =
    i.purpose === "appraise"
      ? lines(partials && `Narrator partials:\n${partials}`, policyPromptBlock(k, "appraise_static", promptVars))
      : "";
  const characterBlock =
    def &&
    lines(
      `You are ${displayName}${displayName !== identity?.name ? ` (${identity?.name})` : ""}.`,
      identity?.summary,
      personaBlock,
      def.card.style && `Style: ${def.card.style}`,
      (identity?.style_examples?.length ?? 0) > 0 &&
        `Style examples:\n${identity!.style_examples!.map((x) => `- ${x}`).join("\n")}`,
      (constraints?.motives?.length ?? 0) > 0 && `Motives: ${constraints!.motives!.join("; ")}`,
      bottomHard.length > 0 && `Hard limits:\n${bottomHard.map((b) => `- ${b.text}`).join("\n")}`,
      bottomSoft.length > 0 && `Soft limits:\n${bottomSoft.map((b) => `- ${b.text}`).join("\n")}`,
      (constraints?.taboos?.length ?? 0) > 0 && `Taboos: ${constraints!.taboos!.join(", ")}`,
    );

  return joinStaticSections(
    [
      engineOutputRules(k),
      getPromptSection(promptLocale(k), "player_visible_language", { tag: lang }),
      renderExtra,
      appraiseExtra,
      characterBlock,
      unlockedSecretsText(k, i.speaker),
      rules && `World rules:\n${rules}`,
      formatCueSpec(k),
      formatChoicesSpec(k),
      alwaysDocs.length > 0 &&
        lines(
          "Background knowledge:",
          alwaysDocs.map((d) => `## ${d.name}\n${d.body.trim()}`).join("\n\n"),
        ),
    ],
    maxStatic,
  );
}

function relationSummary(k: Kernel, speaker: CharacterId, participants: CharacterId[]): string {
  const def = k.catalog.character(speaker);
  if (!def) return "";
  const st = k.timeline.state().characters[speaker];
  const rows: string[] = [];
  const others = [...participants].filter((p) => p !== speaker).sort();
  for (const pid of others) {
    const rel = def.relations.find((r) => r.to === pid);
    const toward = st?.tracks.toward[pid] ?? {};
    const tierToward = st?.tiers.toward[pid] ?? {};
    const trackBits = Object.keys(toward)
      .sort()
      .map((tr) => `${tr}=${toward[tr]}`)
      .join(", ");
    const tierBits = Object.keys(tierToward)
      .sort()
      .map((tr) => `${tr}:${tierToward[tr] ?? "?"}`)
      .join(", ");
    rows.push(`- ${pid}${rel ? ` (${rel.kind})` : ""}${trackBits ? ` tracks[${trackBits}]` : ""}${tierBits ? ` tiers[${tierBits}]` : ""}`);
  }
  return rows.length ? lines("Relations:", rows.join("\n")) : "";
}

function semiStaticSegment(k: Kernel, i: PromptInput): string {
  const loc = k.catalog.location(i.scene.location);
  const participants = [...i.scene.participants].sort();
  const ctx = k.celContext({ self: i.speaker, other: i.addressee, sceneId: i.scene.id });
  const inj = k.m.memory.knowledge({ owner: i.speaker, location: i.scene.location, sceneId: i.scene.id, ctx });
  const indexLines = inj.index.sort((a, b) => a.id.localeCompare(b.id)).map((x) => `- ${x.name}: ${x.description} (id=${x.id})`);
  const summary = syncMemorySummary(k, i.speaker);
  const beat = k.m.director.beatNote?.();

  const maxSemi = k.policy.render.maxSegmentChars?.semiStatic;
  return truncateToCharBudget(
    lines(
      relationSummary(k, i.speaker, participants),
      tierBehaviorDirectives(k, i.speaker, i.addressee),
      summary && `Memory summary:\n${summary}`,
      indexLines.length > 0 && lines("Knowledge index (on-demand; use read tool in S2):", indexLines.join("\n")),
      lines(
        "Scene:",
        `- id: ${i.scene.id}`,
        `- location: ${i.scene.location}${loc?.description ? ` — ${loc.description}` : loc?.summary ? ` — ${loc.summary}` : ""}`,
        `- participants: ${participants.join(", ")}`,
      ),
      beat && `Active beat: ${beat}`,
    ),
    maxSemi,
  );
}

function fieldEffectsText(fx: PromptInput["fieldEffects"]): string {
  const parts: string[] = [];
  if (fx.topic_access) {
    const { open = [], close = [] } = fx.topic_access;
    if (close.length) parts.push(`Topics closed: ${[...close].sort().join(", ")}`);
    if (open.length) parts.push(`Topics open: ${[...open].sort().join(", ")}`);
  }
  if (fx.salience?.length) {
    parts.push(`Salience boosts: ${fx.salience.map((s) => `${s.tags.join("+")}:${s.boost}`).join("; ")}`);
  }
  if (fx.world_vars && Object.keys(fx.world_vars).length) {
    const keys = Object.keys(fx.world_vars).sort();
    parts.push(`World context: ${keys.map((key) => `${key}=${JSON.stringify(fx.world_vars![key])}`).join(", ")}`);
  }
  if (fx.intent_force) parts.push(`You must intent: ${fx.intent_force}`);
  if (fx.intent_forbid?.length) parts.push(`Forbidden intents: ${fx.intent_forbid.join(", ")}`);
  if (fx.intent_bias && Object.keys(fx.intent_bias).length) {
    parts.push(`Intent bias: ${JSON.stringify(fx.intent_bias)}`);
  }
  if (fx.hide_entities?.length) {
    parts.push(`You do not perceive these entities in this scene: ${[...fx.hide_entities].sort().join(", ")}`);
  }
  if (fx.disguise && Object.keys(fx.disguise).length) {
    parts.push(`Names appear to you as: ${JSON.stringify(fx.disguise)}`);
  }
  if (fx.inject_belief?.length) {
    parts.push("Your beliefs (true for you):", fx.inject_belief.map((b) => `- ${b.text}`).join("\n"));
  }
  return parts.join("\n");
}

function dynamicSegment(k: Kernel, i: PromptInput, whenDocs: KnowledgeDoc[]): string {
  const tierLabel = i.tier ? `Model tier: ${i.tier.toUpperCase()}` : "";
  const lengthHint = i.purpose === "render" ? tierLengthHint(k, i.tier) : "";
  const trackLines =
    i.tracks && Object.keys(i.tracks).length
      ? `Tracks: ${Object.keys(i.tracks)
          .sort()
          .map((t) => `${t}=${i.tracks![t]}`)
          .join(", ")}`
      : "";
  const tierLines =
    i.tiers && Object.keys(i.tiers).length
      ? `Tiers: ${Object.keys(i.tiers)
          .sort()
          .map((t) => `${t}=${i.tiers![t] ?? "none"}`)
          .join(", ")}`
      : "";

  const whenSorted = [...whenDocs].sort((a, b) => a.id.localeCompare(b.id));
  const hitLines = (i.hits ?? [])
    .slice()
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .map((h) => {
      const prefix = h.distortion ? `Your memory is hazy: ${h.distortion}. ` : "";
      return `- (${h.kind}:${h.id}, score=${h.score.toFixed(2)}) ${prefix}${h.text.slice(0, 400)}`;
    });

  const sidenotes = (i.sidenotes ?? [])
    .slice()
    .sort((a, b) => a.noteId.localeCompare(b.noteId))
    .map((n) => (n.verbatim ? `[verbatim sidenote] ${n.text}` : `[sidenote] ${n.text}`));

  const intentBlock =
    i.intent &&
    lines(
      `Decided intent (imperative — perform this): ${i.intent.intent}${i.intent.forced ? " (forced)" : ""}`,
      'When followed, set "intent_realized" to this exact string.',
      Object.keys(i.intent.scores).length ? `Intent scores: ${JSON.stringify(i.intent.scores)}` : "",
    );

  const appraiseHint =
    i.appraisal &&
    lines(`Appraised event type: ${i.appraisal.type}`, i.appraisal.tags.length ? `Tags: ${i.appraisal.tags.join(", ")}` : "");

  const maxDyn = k.policy.render.maxSegmentChars?.dynamic;
  return truncateToCharBudget(
    lines(
      tierLabel,
      lengthHint,
      trackLines,
      tierLines,
      fieldEffectsText(i.fieldEffects),
      whenSorted.length > 0 &&
        lines("Contextual knowledge:", whenSorted.map((d) => `## ${d.name}\n${d.body.trim()}`).join("\n\n")),
      hitLines.length > 0 && lines("Recalled memories/knowledge:", hitLines.join("\n")),
      sidenotes.length > 0 && lines("Director sidenotes:", sidenotes.join("\n")),
      intentBlock,
      appraiseHint,
      i.extraDynamic,
    ),
    maxDyn,
  );
}

function formatDelimitedActorText(k: Kernel, actorText: string): string {
  return getPromptSection(promptLocale(k), "appraise_actor_delimiter", { actorText });
}

function userMessage(k: Kernel, i: PromptInput): string {
  if (i.purpose === "appraise") {
    return formatDelimitedActorText(k, i.actorText ?? "");
  }
  return lines(getPromptSection(promptLocale(k), "render_user"), i.appraisal?.type && `Event context: ${i.appraisal.type}`);
}

/** Build §17.4 prompt segments (deterministic ordering). */
export function buildPromptSegments(k: Kernel, i: PromptInput): PromptSegments {
  const ctx = k.celContext({
    self: i.speaker,
    other: i.addressee,
    actor: i.addressee,
    event: i.appraisal,
    sceneId: i.scene.id,
  });
  const inj = k.m.memory.knowledge({ owner: i.speaker, location: i.scene.location, sceneId: i.scene.id, ctx });

  return {
    static: staticSegment(k, i),
    semiStatic: semiStaticSegment(k, i),
    dynamic: dynamicSegment(k, i, inj.when),
    history: historyToMessages(i.history),
    user: userMessage(k, i),
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
