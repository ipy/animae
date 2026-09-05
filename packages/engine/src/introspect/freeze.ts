import type { JsonValue } from "../types.ts";

export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  const copy = structuredClone(value) as T;
  freezeInPlace(copy);
  return copy;
}

function freezeInPlace(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  Object.freeze(value);
  if (Array.isArray(value)) {
    for (const v of value) freezeInPlace(v);
  } else {
    for (const v of Object.values(value as Record<string, unknown>)) freezeInPlace(v);
  }
}

export function asJson(value: unknown): JsonValue | undefined {
  if (value === undefined) return undefined;
  try {
    return structuredClone(value) as JsonValue;
  } catch {
    return undefined;
  }
}
