import type { FormatParams, JsonValue } from "./types.ts";

/** Language-neutral message for logs/API; UI layers localize via catalog keys. */
export interface StructuredMessage {
  code: string;
  params?: Record<string, JsonValue>;
  namespace?: string;
}

export function structuredMessage(
  code: string,
  params?: Record<string, JsonValue>,
  namespace?: string,
): StructuredMessage {
  return namespace ? { code, params, namespace } : params ? { code, params } : { code };
}

export function formatStructuredMessage(
  msg: StructuredMessage,
  t: (key: string, params?: FormatParams) => string,
): string {
  const key = msg.namespace ? `${msg.namespace}:${msg.code}` : msg.code;
  return t(key, msg.params);
}
