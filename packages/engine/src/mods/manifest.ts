import { z } from "zod";
import { Id, Tags } from "../schema/common.ts";

const kebabId = z
  .string()
  .regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, "mod id must be kebab-case");

export const ModManifestSchema = z.strictObject({
  id: kebabId,
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/, "version must be semver"),
  description: z.string().optional(),
  engine: z.string().optional(),
  requires: z.array(z.string()).default([]),
  conflicts: z.array(z.string()).default([]),
  loadAfter: z.array(z.string()).default([]),
  rating: z.string().optional(),
  tags: Tags.default([]),
  notice: z.string().optional(),
  provides: z.array(z.string()).optional(),
});

export type ModManifestDoc = z.infer<typeof ModManifestSchema>;
