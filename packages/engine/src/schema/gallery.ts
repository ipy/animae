import { z } from "zod";
import { Cel, Id, Tags } from "./common.ts";

export const GallerySizeSchema = z.strictObject({
  width: z.number().int().positive().default(768),
  height: z.number().int().positive().default(512),
});

export const GalleryBriefConfigSchema = z.strictObject({
  tier: z.enum(["s1", "s2"]).default("s1"),
  guidance: z.string().default(""),
});

export const GalleryRatingDefSchema = z.strictObject({
  label: z.union([z.string(), z.record(z.string(), z.unknown())]),
  when: Cel.default("true"),
  style: z.string().default(""),
  negative: z.string().default(""),
  brief: z.string().default(""),
});

export const GalleryPresetImageSchema = z.strictObject({
  src: z.string().min(1),
});

export const GalleryPresetRenderSchema = z.strictObject({
  prompt: z.string().min(1),
  negative: z.string().default(""),
  seed: z.number().int().optional(),
  auto: z.boolean().default(false),
});

export const GalleryPresetEntrySchema = z.strictObject({
  title: z.union([z.string(), z.record(z.string(), z.unknown())]),
  caption: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
  hint: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
  showTitleWhenLocked: z.boolean().default(false),
  lockedTitle: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
  group: z.string().default("default"),
  order: z.number().default(0),
  rating: z.string().default("general"),
  characters: z.array(z.string()).default([]),
  location: z.string().optional(),
  tags: Tags,
  unlock: z.strictObject({ when: Cel }).optional(),
  image: GalleryPresetImageSchema.optional(),
  render: GalleryPresetRenderSchema.optional(),
});

export const GalleryConfigSchema = z.strictObject({
  enabled: z.boolean().optional(),
  defaultRating: z.string().default("general"),
  promptLanguage: z.string().default("en"),
  style: z.string().default(""),
  negative: z.string().default(""),
  size: GallerySizeSchema.default({ width: 768, height: 512 }),
  maxCharacters: z.number().int().min(0).default(3),
  maxCaptured: z.number().int().min(0).default(200),
  brief: GalleryBriefConfigSchema.default({ tier: "s1", guidance: "" }),
  generator: z.strictObject({ options: z.record(z.string(), z.unknown()).default({}) }).default({ options: {} }),
  ratings: z.record(z.string(), GalleryRatingDefSchema).default({}),
  entries: z.record(Id, GalleryPresetEntrySchema).default({}),
});

export type GalleryConfig = z.infer<typeof GalleryConfigSchema>;
export type GalleryPresetEntry = z.infer<typeof GalleryPresetEntrySchema>;
export type GalleryRatingDef = z.infer<typeof GalleryRatingDefSchema>;
