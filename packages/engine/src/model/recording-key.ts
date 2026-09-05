import type { ZodType } from "zod";
import { z } from "zod";
import type { ModelRequestBase, ToolDef } from "../ports.ts";
import { sha256Hex, stableStringify } from "../store/util.ts";

function schemaFingerprint(schema: ZodType<unknown>): unknown {
  return z.toJSONSchema(schema);
}

export function recordingKey(
  modelId: string,
  req: ModelRequestBase & { schema: ZodType<unknown> },
): string {
  const payload = {
    model: modelId,
    label: req.label,
    segments: req.segments,
    schema: schemaFingerprint(req.schema),
    tools: (req.tools ?? []).map((t: ToolDef) => t.name).sort(),
    maxOutputTokens: req.maxOutputTokens,
    maxSteps: req.maxSteps ?? (req.tools?.length ? 3 : 1),
    temperature: req.temperature,
    seed: req.seed,
  };
  return sha256Hex(stableStringify(payload));
}
