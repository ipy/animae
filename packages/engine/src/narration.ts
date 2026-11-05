import { z } from "zod";
import type { EventDraft } from "./types.ts";
import type { NarrationStyle } from "./types.ts";

/** How a narration paragraph is presented: an ordinary paragraph, or a scene break (a divider with optional text). */
export const NarrationStyleSchema = z.enum(["normal", "scene_break"]);

/** One narration paragraph in a render answer (`narrations[]`). `style` defaults to `normal`. */
export const NarrationItemSchema = z.strictObject({
  /** Written before `text` so a streaming model reveals the style first. */
  style: NarrationStyleSchema.default("normal"),
  text: z.string().refine((s) => s.trim().length > 0, { message: "narration text must not be empty" }),
});
export type NarrationItem = z.infer<typeof NarrationItemSchema>;

/** The `narration` event: speaker-less text with no cues, choices or realized intent. */
export const NarrationEventSchema = z.strictObject({
  kind: z.literal("narration"),
  text: z.string(),
  style: NarrationStyleSchema.default("normal"),
});

/** Draft of a `narration` event; `style` is written explicitly so replays never depend on the default. */
export function narrationDraft(text: string, style: NarrationStyle = "normal", source = "pipeline:render"): EventDraft {
  return { kind: "narration", source, text, style };
}
