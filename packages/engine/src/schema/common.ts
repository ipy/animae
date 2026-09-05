import { z } from "zod";

/**
 * A CEL expression string. Compilation is checked at load time through the pluggable validator
 * (`setCelValidator`, installed by the rules module) so zod errors carry file + path.
 */
export type CelValidator = (expr: string) => string | undefined; // returns an error message or undefined
let celValidator: CelValidator | undefined;
export function setCelValidator(v: CelValidator | undefined): void {
  celValidator = v;
}
export const Cel = z.string().superRefine((s, ctx) => {
  if (!celValidator) return;
  const msg = celValidator(s);
  if (msg) ctx.addIssue({ code: "custom", message: `invalid CEL: ${msg} (in: ${s})` });
});

/** CEL expression or a literal number (YAML convenience) */
export const CelOrNumber = z.union([z.number(), Cel]);
/** CEL expression or a literal boolean */
export const CelOrBool = z.union([z.boolean(), Cel]);

export const Id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/, "id must be [A-Za-z0-9_.:-]");
export const Tags = z.array(z.string()).default([]);

export const WorldTimeSchema = z.strictObject({ day: z.number().int().min(1), minute: z.number().int().min(0) });

export const LevelSchema = z.enum(["L0", "L1", "L2", "L3", "L4"]);
export type Level = z.infer<typeof LevelSchema>;
export const LOD_VALUES = ["extra", "supporting", "principal"] as const;
export const LodSchema = z.enum(LOD_VALUES);

/** Event draft as written in YAML (rules / schedule / anchors). `kind` required; any payload. `source`/`because` are filled by the engine. */
export const EventDraftSchema = z.looseObject({ kind: z.string() });

/** Holder reference of a field / anchor etc. */
export const EntityRefSchema = z.strictObject({
  kind: z.enum(["character", "location", "item", "time", "world", "external"]),
  ref: z.string().optional(),
});
