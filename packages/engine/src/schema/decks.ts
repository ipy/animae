import { z } from "zod";
import { Cel, Id, Tags } from "./common.ts";
import { EventDraftSchema } from "./common.ts";

export const DeckEntrySchema = z.strictObject({
  id: Id,
  weight: z.number().positive().default(1),
  when: Cel.optional(),
  /** Minimum whole days between draws of this entry. */
  cooldownDays: z.number().int().nonnegative().optional(),
  once: z.boolean().default(false),
  tags: Tags,
  emit: z.union([EventDraftSchema, z.array(EventDraftSchema)]).optional(),
});

export type DeckEntry = z.infer<typeof DeckEntrySchema>;

export const DeckDefSchema = z
  .strictObject({
    id: Id,
    drawOn: z.enum(["day"]).default("day"),
    chapter: z.string().optional(),
    when: Cel.optional(),
    maxPerDay: z.number().int().positive().optional(),
    entries: z.array(DeckEntrySchema).min(1),
  })
  .superRefine((d, ctx) => {
    const ids = new Set<string>();
    for (const e of d.entries) {
      if (ids.has(e.id)) ctx.addIssue({ code: "custom", message: `duplicate deck entry id "${e.id}"` });
      ids.add(e.id);
    }
  });

export type DeckDef = z.infer<typeof DeckDefSchema>;
export const DeckFileSchema = DeckDefSchema;
