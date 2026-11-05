import { z } from "zod";
import type { Kernel } from "../contracts.ts";
import type { EntityGenerate } from "../events.ts";
import type { EngineEvent } from "../types.ts";
import { AnimaeError } from "../types.ts";
import { adjudicateProposal } from "./adjudicate.ts";
import { GenerationBriefSchema, buildCharacterSpecFromBrief } from "./generate-brief.ts";
import { templateFieldsSchema } from "./descriptor.ts";
import { buildEntityGeneratePrompt } from "./generate-prompt.ts";
import { entityObject } from "./object-call.ts";
import { spawnSpecToPayload } from "./spawn.ts";
import { message as systemMessage } from "../i18n/system-message.ts";

async function emitGenerateWarning(
  k: Kernel,
  code: "entity.generate_failed" | "entity.generate_invalid",
  messageText: string,
  extra?: Record<string, unknown>,
): Promise<void> {
  await k.emit([
    {
      kind: "config.warning",
      code,
      message: messageText,
      systemMessage: systemMessage("config.warning", { code, message: messageText, ...extra }, "diagnostics"),
      ...extra,
    },
  ]);
}

const EntityGenerateRequestSchema = z.strictObject({
  kind: z.enum(["character", "location", "item"]),
  template: z.string().min(1),
  id: z.string().optional(),
  hints: z.record(z.string(), z.unknown()).optional(),
  brief: GenerationBriefSchema.optional(),
});

export const EntityGeneratePayloadSchema = z.strictObject({
  request: EntityGenerateRequestSchema,
  reason: z.string().optional(),
});

export type EntityGeneratePayload = z.infer<typeof EntityGeneratePayloadSchema>;

export function parseEntityGeneratePayload(raw: unknown): EntityGeneratePayload {
  return EntityGeneratePayloadSchema.parse(raw);
}

function outputLanguage(k: Kernel, hints?: Record<string, unknown>): string {
  const hintLang = hints?.language;
  if (typeof hintLang === "string") return hintLang;
  return k.i18n.outputLocale ?? k.authored.world.language;
}

async function persistGenerated(
  k: Kernel,
  ref: import("../types.ts").EntityRef,
  data: Record<string, unknown>,
  template: string,
): Promise<void> {
  const branch = k.timeline.branch().name;
  const path = `timelines/${branch}/entities/${ref.kind}/${ref.id}.json`;
  await k.storage.mkdir(`timelines/${branch}/entities/${ref.kind}`);
  const payload = { ...data, _template: template };
  await k.storage.writeAtomic(path, JSON.stringify(payload, null, 2));
}

/**
 * Run S1 entity generation for a persisted `entity.generate` request. Emits `entity.created` or a warning; never throws.
 */
export async function fulfillEntityGenerateRequest(
  k: Kernel,
  request: EngineEvent<EntityGenerate>,
): Promise<void> {
  let payload: EntityGeneratePayload;
  try {
    payload = parseEntityGeneratePayload({ request: request.request, reason: request.reason });
  } catch (e) {
    await emitGenerateWarning(k, "entity.generate_invalid", e instanceof Error ? e.message : String(e), {
      eventId: request.id,
    });
    return;
  }

  try {
    const req = payload.request;
    if (req.brief && req.kind === "character") {
      const spec = await buildCharacterSpecFromBrief(k, req.brief, {});
      const tplId = req.template ?? req.brief.template ?? "extra";
      const { ref, data } = spawnSpecToPayload(k, spec, { id: req.id });
      await persistGenerated(k, ref, data, tplId);
      await k.emit(
        [
          {
            kind: "entity.created",
            entity: ref,
            template: tplId,
            data,
            source: request.source ?? "entity.generate",
            because: [request.id],
          },
        ],
        { source: request.source, because: [request.id] },
      );
      return;
    }

    const tpl = k.authored.templates[req.kind][req.template];
    if (!tpl) throw new AnimaeError("NOT_FOUND", `template ${req.kind}/${req.template} not found`);

    const hints = { ...(req.hints ?? {}), ...(req.id ? { id: req.id } : {}) };
    const schema = templateFieldsSchema(tpl.fields);
    const language = outputLanguage(k, hints);
    const segments = buildEntityGeneratePrompt(k, tpl, { kind: req.kind, template: req.template, hints }, language);
    const recordingKey = `entity:generate:${request.id}`;

    const raw = await entityObject(k, {
      schema,
      segments,
      extra: { template: tpl, templateId: req.template, ...(Object.keys(hints).length ? { hints } : {}) },
      key: recordingKey,
      maxOutputTokens: 4096,
      temperature: 0.7,
    });
    const proposal = schema.parse(raw) as Record<string, unknown>;
    const { ref, data } = adjudicateProposal(req.kind, tpl, proposal, k.catalog, hints);
    await persistGenerated(k, ref, data, req.template);
    await k.emit(
      [
        {
          kind: "entity.created",
          entity: ref,
          template: req.template,
          data,
          source: request.source ?? "entity.generate",
          because: [request.id],
        },
      ],
      { source: request.source, because: [request.id] },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const code = e instanceof AnimaeError ? e.code : "entity.generate_failed";
    await emitGenerateWarning(k, "entity.generate_failed", message, { eventId: request.id, code });
  }
}

export async function fulfillEntityGenerateBatch(k: Kernel, persisted: readonly EngineEvent[]): Promise<void> {
  for (const ev of persisted) {
    if (ev.kind !== "entity.generate") continue;
    await fulfillEntityGenerateRequest(k, ev as unknown as EngineEvent<EntityGenerate>);
  }
}
