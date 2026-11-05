import type { Kernel, TurnCtx } from "../contracts.ts";
import type { Appraisal } from "../events.ts";
import type { Choice, EventDraft } from "../types.ts";
import { recordingKey } from "../model/recording-key.ts";
import { appraiseBindingFor, currentMode, llmRoles, modelErrorContext, ruleModelOf, s1SpecOf } from "../model/select.ts";
import { withRuleFallback } from "../runtime/fallback.ts";
import { buildCallContext, EMPTY_SEGMENTS } from "./call-context.ts";
import { buildAppraiseSchema } from "./schemas.ts";
import { buildPromptSegments } from "./prompt.ts";
import { appraiseTypeLine, policyText } from "./policy-labels.ts";
import { getPromptSection } from "../prompts/index.ts";
import { prepareAuthoredProse } from "./prompt-prose.ts";
import { routerBudgetK } from "../router/policy-access.ts";
import type { AppraiseInput, AppraiseStageResult } from "./types.ts";
import { rethrowPipelineModelError } from "./model-error.ts";
import { resolveModelTimeoutMs } from "../model/timeout.ts";

function normalizeTags(tags: string[]): string[] {
  const out = new Set<string>();
  for (const t of tags) {
    const n = t.trim().toLowerCase();
    if (n) out.add(n);
  }
  return [...out].sort();
}

function postProcessAppraisal(raw: Record<string, unknown>, policy: Kernel["policy"]): Appraisal {
  const types = policy.events.types;
  let type = String(raw.type ?? "other").toLowerCase();
  if (!(type in types)) {
    const hit = Object.keys(types).find((k) => k.toLowerCase() === type);
    type = hit ?? "other";
  }
  let intensity = Number(raw.intensity) || 0;
  if (intensity >= 10 && intensity <= 100) intensity /= 100;
  else if (intensity > 1) intensity = 1;
  intensity = Math.min(1, Math.max(0, intensity));
  let sincerity = Number(raw.sincerity) || 0;
  if (sincerity >= 10 && sincerity <= 100) sincerity /= 100;
  else if (sincerity > 1) sincerity = 1;
  sincerity = Math.min(1, Math.max(0, sincerity));
  const claims = Array.isArray(raw.claims)
    ? (raw.claims as { s: string; p: string; o: string }[]).filter((c) => c.s && c.p && c.o)
    : [];
  const search_terms = Array.isArray(raw.search_terms) ? (raw.search_terms as string[]).map((s) => String(s).trim()).filter(Boolean) : [];
  const tags = normalizeTags(Array.isArray(raw.tags) ? (raw.tags as string[]) : []);
  let input_class = String(raw.input_class ?? "normal").toLowerCase() as Appraisal["input_class"];
  if (!["normal", "injection_suspect", "meta_probe"].includes(input_class)) input_class = "normal";
  let approach = raw.approach != null && String(raw.approach).length ? String(raw.approach).toLowerCase() : undefined;
  const approaches = (policy.x?.approaches as string[] | undefined) ?? [];
  if (approach && approaches.length) {
    const hit = approaches.find((a) => a.toLowerCase() === approach);
    approach = hit;
  }
  const base: Appraisal = { type, intensity, sincerity, claims, search_terms, tags, input_class, approach };
  if (policy.safety.enabled) {
    const allowed = ["none", "self_harm", "real_world_danger", "sexual_minors", "personal_crisis"] as const;
    let safety = String(raw.safety ?? "none").toLowerCase();
    if (!(allowed as readonly string[]).includes(safety)) safety = "none";
    base.safety = safety as Appraisal["safety"];
  }
  return base;
}

function choiceFromTimeline(k: Kernel, choiceId?: string): Choice | undefined {
  if (!choiceId) return undefined;
  const events = k.timeline.events();
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (!e || e.kind !== "choice.offered") continue;
    const choices = (e as { choices?: Choice[] }).choices ?? [];
    const hit = choices.find((c) => c.id === choiceId);
    if (hit) return { ...hit, tags: hit.tags ?? [] };
  }
  return undefined;
}

function approachListLine(k: Kernel, approaches: string[]): string {
  const loc = k.i18n.promptLocale;
  const parts = approaches.map((id) => {
    const label = policyText(k, "approach", id, "label");
    return label && label.toLowerCase() !== id.toLowerCase() ? getPromptSection(loc, "appraise_approach_item", { id, label }) : id;
  });
  return parts.join(getPromptSection(loc, "appraise_approach_sep"));
}

function appraiseInstructions(k: Kernel): string {
  const types = k.policy.events.types;
  const loc = k.i18n.promptLocale;
  const typeLines = Object.keys(types)
    .sort((x, y) => x.localeCompare(y))
    .map((key) => appraiseTypeLine(k, key))
    .filter(Boolean);
  const approaches = (k.policy.x?.approaches as string[] | undefined) ?? [];
  const examples = (k.policy.x?.prompt as { appraise_examples?: string } | undefined)?.appraise_examples ?? "";

  const approachLine = approaches.length
    ? getPromptSection(loc, "appraise_approach_optional", { list: approachListLine(k, approaches) })
    : getPromptSection(loc, "appraise_approach_omit");
  const safetyLine = k.policy.safety.enabled ? getPromptSection(loc, "appraise_safety_enabled") : "";
  return [
    getPromptSection(loc, "appraise_task", {
      approachLine,
      safetyLine,
      typeLines: typeLines.join("\n"),
    }),
    examples ? prepareAuthoredProse(k, examples) : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function appraiseStage(k: Kernel, t: TurnCtx, i: AppraiseInput): Promise<AppraiseStageResult> {
  const choice = choiceFromTimeline(k, i.choiceId ?? t.choiceId);
  const hint = choice ? { expected_event_type: choice.expected_event_type, tags: choice.tags } : undefined;
  const schema = buildAppraiseSchema(k.policy);
  const useLlm = (i.backend ?? currentMode(k).appraise) === "llm" && llmRoles(k).s1;

  const callRule = (): Promise<Record<string, unknown>> =>
    ruleModelOf(k).object({
      label: "appraise",
      purpose: "appraise",
      segments: EMPTY_SEGMENTS,
      schema,
      maxOutputTokens: routerBudgetK(k).maxOutputTokens.s1,
      context: buildCallContext(k, {
        purpose: "appraise",
        self: i.speaker,
        other: i.addressee,
        actor: i.actor,
        sceneId: i.scene.id,
        input: {
          text: i.actorText,
          ...(choice ? { choiceId: choice.id } : {}),
          addressee: i.addressee,
          ...(choice
            ? {
                choice: {
                  expected_event_type: choice.expected_event_type,
                  tags: choice.tags,
                  ...(choice.intensity !== undefined ? { intensity: choice.intensity } : {}),
                  ...(choice.sincerity !== undefined ? { sincerity: choice.sincerity } : {}),
                  ...(choice.approach ? { approach: choice.approach } : {}),
                },
              }
            : {}),
        },
        inputEventId: i.inputEventId,
        turn: t,
      }),
    }) as Promise<Record<string, unknown>>;

  let recording: string | undefined;
  const callLlm = async (): Promise<Record<string, unknown>> => {
    const segments = buildPromptSegments(k, {
      purpose: "appraise",
      speaker: i.speaker,
      addressee: i.addressee,
      scene: i.scene,
      history: i.history,
      fieldEffects: i.fieldEffects,
      actorText: i.actorText,
      outputLocale: t.outputLocale,
      // The task, event types and examples are the same every turn: they belong to the cacheable static segment. Only
      // the hint attached to a chosen quick reply changes per turn.
      extraStatic: appraiseInstructions(k),
      extraDynamic: hint
        ? getPromptSection(k.i18n.promptLocale, "choice_hint", {
            type: hint.expected_event_type,
            tags: hint.tags.join(","),
          })
        : "",
    });
    const req = {
      label: "appraise",
      purpose: "appraise" as const,
      segments,
      schema,
      maxOutputTokens: routerBudgetK(k).maxOutputTokens.s1,
      temperature: k.policy.render.temperature,
      seed: k.authored.config.seed,
      recordingLocales: {
        promptLocale: k.i18n.promptLocale,
        outputLocale: t.outputLocale ?? k.i18n.outputLocale,
        contentLocale: k.i18n.contentLocale,
      },
    };
    if ((k.timeline.recordings?.mode ?? "live") !== "live") recording = recordingKey(k.models.s1.id, req);
    try {
      return (await k.models.s1.object(req)) as Record<string, unknown>;
    } catch (err) {
      rethrowPipelineModelError(
        err,
        "APPRAISE_FAILED",
        "Appraise model call failed",
        modelErrorContext(s1SpecOf(k), resolveModelTimeoutMs),
      );
    }
  };

  const fallbackDrafts: EventDraft[] = [];
  let raw: Record<string, unknown>;
  let backend: "llm" | "rule";
  if (useLlm) {
    const r = await withRuleFallback(k, "appraise", "pipeline:appraise", callLlm, callRule, (d) => {
      fallbackDrafts.push(d);
    });
    raw = r.value;
    backend = r.backend;
  } else {
    raw = await callRule();
    backend = "rule";
  }
  if (backend === "rule") recording = undefined;

  if (hint) {
    if (!raw.type) raw.type = hint.expected_event_type;
    if (!Array.isArray(raw.tags) || (raw.tags as string[]).length === 0) raw.tags = hint.tags;
  }

  const appraisal = postProcessAppraisal(raw, k.policy);
  const drafts: EventDraft[] = [
    ...fallbackDrafts,
    {
      kind: "appraisal",
      source: "pipeline:appraise",
      actor: i.actor,
      addressee: i.addressee,
      appraisal,
      ...(recording ? { recording } : {}),
    },
    {
      kind: "input.classified",
      source: "pipeline:appraise",
      actor: i.actor,
      input_class: appraisal.input_class,
    },
  ];

  let safety: AppraiseStageResult["safety"];
  if (k.policy.safety.enabled && appraisal.safety && appraisal.safety !== "none") {
    const response = k.policy.safety.response;
    safety = { category: appraisal.safety, response };
    if (k.policy.safety.log) {
      drafts.push({
        kind: "safety.flagged",
        source: "pipeline:appraise",
        actor: i.actor,
        category: appraisal.safety,
        response,
      });
    }
  }

  return { appraisal, drafts, safety, binding: backend === "llm" ? appraiseBindingFor(k, "llm") : { backend: "rule" } };
}
