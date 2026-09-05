import { z } from "zod";
import { defaultTheme } from "./defaults.ts";
import type { Theme } from "../types.ts";

const colorSchema = z.string().min(1);

export const themeSchema = z
  .object({
    colors: z
      .object({
        primary: colorSchema.optional(),
        npc: colorSchema.optional(),
        player: colorSchema.optional(),
        narration: colorSchema.optional(),
        warning: colorSchema.optional(),
        dim: colorSchema.optional(),
        border: colorSchema.optional(),
      })
      .optional(),
    border: z.enum(["single", "double", "round", "bold", "none"]).optional(),
    typewriter: z
      .object({
        charsPerSecond: z.number().positive().optional(),
        enabled: z.boolean().optional(),
      })
      .optional(),
    sidePanel: z
      .object({
        width: z.number().min(10).max(50).optional(),
        show: z
          .array(z.enum(["participants", "tracks", "fields", "anchor"]))
          .optional(),
      })
      .optional(),
    bell: z.boolean().optional(),
  })
  .strict();

export type ThemePatch = z.infer<typeof themeSchema>;

export function mergeTheme(partial: ThemePatch): Theme {
  const width = partial.sidePanel?.width;
  return {
    colors: { ...defaultTheme.colors, ...partial.colors },
    border: partial.border ?? defaultTheme.border,
    typewriter: { ...defaultTheme.typewriter, ...partial.typewriter },
    sidePanel: {
      widthPercent: width ?? defaultTheme.sidePanel.widthPercent,
      show: partial.sidePanel?.show ?? defaultTheme.sidePanel.show,
    },
    bell: partial.bell ?? defaultTheme.bell,
  };
}
