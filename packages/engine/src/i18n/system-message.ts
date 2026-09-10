import type { JsonValue } from "../types.ts";

/** Language-neutral user-visible copy; localize at UI boundaries with catalog keys. */
export type SystemMessage = {
  code: string;
  params?: Record<string, JsonValue>;
  /** Catalog namespace when `code` is not already `namespace:path`. */
  namespace?: string;
};

export function message(
  code: string,
  params?: Record<string, JsonValue>,
  namespace?: string,
): SystemMessage {
  if (namespace) return { code, params, namespace };
  return params ? { code, params } : { code };
}

/** Shorthand for timeline / panel payloads (`LocalizedMessage` shape). */
export function localized(
  key: string,
  params?: Record<string, JsonValue>,
  ns?: string,
): import("./localized-message.ts").LocalizedMessage {
  return ns ? { key, params, ns } : params ? { key, params } : { key };
}

export function systemMessageKey(msg: SystemMessage): string {
  return msg.namespace ? `${msg.namespace}:${msg.code}` : msg.code;
}

export function formatSystemMessage(
  msg: SystemMessage,
  t: (key: string, params?: Record<string, JsonValue>) => string,
): string {
  return t(systemMessageKey(msg), msg.params);
}
