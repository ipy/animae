import { z } from "zod";

export const CgBriefOutputSchema = z.strictObject({
  title: z.string().min(1),
  caption: z.string().default(""),
  prompt: z.string().min(1),
  negative: z.string().optional(),
  characters: z
    .array(
      z.strictObject({
        name: z.string(),
        visual: z.string().optional(),
      }),
    )
    .default([]),
});

export type CgBriefOutput = z.infer<typeof CgBriefOutputSchema>;
