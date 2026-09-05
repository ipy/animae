import type { FieldDescriptor } from "../schema/authored.ts";
import { AnimaeError } from "../types.ts";

export function validateWorldVar(path: string, value: unknown, schema: Record<string, FieldDescriptor> | undefined): void {
  if (!schema || Object.keys(schema).length === 0) return;
  const desc = schema[path];
  if (!desc) return;
  validateDescriptor(value, desc, path);
}

function validateDescriptor(value: unknown, desc: FieldDescriptor, path: string): void {
  if (desc.type === "string") {
    if (typeof value !== "string") throw new AnimaeError("WORLD_VAR_INVALID", `${path}: expected string`);
    if (desc.enum && !desc.enum.includes(value)) throw new AnimaeError("WORLD_VAR_INVALID", `${path}: not in enum`);
    return;
  }
  if (desc.type === "number" || desc.type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new AnimaeError("WORLD_VAR_INVALID", `${path}: expected number`);
    if (desc.type === "integer" && !Number.isInteger(value)) throw new AnimaeError("WORLD_VAR_INVALID", `${path}: expected integer`);
    if (desc.min != null && value < desc.min) throw new AnimaeError("WORLD_VAR_INVALID", `${path}: below min`);
    if (desc.max != null && value > desc.max) throw new AnimaeError("WORLD_VAR_INVALID", `${path}: above max`);
    if (desc.enum && !desc.enum.includes(value)) throw new AnimaeError("WORLD_VAR_INVALID", `${path}: not in enum`);
    return;
  }
  if (desc.type === "boolean") {
    if (typeof value !== "boolean") throw new AnimaeError("WORLD_VAR_INVALID", `${path}: expected boolean`);
    return;
  }
  if (desc.type === "array") {
    if (!Array.isArray(value)) throw new AnimaeError("WORLD_VAR_INVALID", `${path}: expected array`);
    if (desc.max != null && value.length > desc.max) throw new AnimaeError("WORLD_VAR_INVALID", `${path}: array too long`);
    value.forEach((v, i) => validateDescriptor(v, desc.items, `${path}[${i}]`));
    return;
  }
  if (desc.type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new AnimaeError("WORLD_VAR_INVALID", `${path}: expected object`);
    }
    const obj = value as Record<string, unknown>;
    for (const [k, fd] of Object.entries(desc.fields)) {
      if (!(k in obj)) {
        if (!fd.optional) throw new AnimaeError("WORLD_VAR_INVALID", `${path}.${k}: required`);
        continue;
      }
      validateDescriptor(obj[k], fd, `${path}.${k}`);
    }
  }
}
