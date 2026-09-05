import { z } from "zod";
import type { FieldDescriptor } from "../schema/authored.ts";

export function descriptorToZod(desc: FieldDescriptor): z.ZodType<unknown> {
  switch (desc.type) {
    case "string": {
      let s = z.string();
      if (desc.enum) s = s.refine((v) => desc.enum!.includes(v), { message: "must be one of enum values" });
      return desc.optional ? s.optional() : s;
    }
    case "number": {
      let n = z.number();
      if (desc.min !== undefined) n = n.min(desc.min);
      if (desc.max !== undefined) n = n.max(desc.max);
      return desc.optional ? n.optional() : n;
    }
    case "integer": {
      let n = z.number().int();
      if (desc.min !== undefined) n = n.min(desc.min);
      if (desc.max !== undefined) n = n.max(desc.max);
      return desc.optional ? n.optional() : n;
    }
    case "boolean":
      return desc.optional ? z.boolean().optional() : z.boolean();
    case "array": {
      let a = z.array(descriptorToZod(desc.items));
      if (desc.max !== undefined) a = a.max(desc.max);
      return desc.optional ? a.optional() : a;
    }
    case "object": {
      const shape: Record<string, z.ZodType<unknown>> = {};
      for (const [k, fd] of Object.entries(desc.fields)) shape[k] = descriptorToZod(fd);
      const o = z.strictObject(shape);
      return desc.optional ? o.optional() : o;
    }
    default:
      return z.unknown();
  }
}

export function templateFieldsSchema(fields: Record<string, FieldDescriptor>): z.ZodType<Record<string, unknown>> {
  const shape: Record<string, z.ZodType<unknown>> = {};
  for (const [k, fd] of Object.entries(fields)) shape[k] = descriptorToZod(fd);
  return z.strictObject(shape);
}
