import type { JsonValue } from "../types.ts";
import type { SystemMessage } from "./system-message.ts";
import { formatSystemMessage, systemMessageKey } from "./system-message.ts";

/** Language-neutral player/system copy; resolve at UI boundaries (per viewer locale). */
export type LocalizedMessage = {
  key: string;
  params?: Record<string, JsonValue>;
  /** Catalog namespace when `key` is not already `namespace:path`. */
  ns?: string;
};

export function localizedMessageKey(msg: LocalizedMessage): string {
  return msg.ns ? `${msg.ns}:${msg.key}` : msg.key;
}

/** Resolve a message or plain string; plain strings pass through (legacy / generated LLM text). */
export function renderMessage(
  msg: LocalizedMessage | string | undefined,
  t: (key: string, params?: Record<string, JsonValue>) => string,
): string {
  if (msg == null) return "";
  if (typeof msg === "string") return msg;
  return t(localizedMessageKey(msg), msg.params);
}

export function toLocalizedMessage(msg: SystemMessage): LocalizedMessage {
  return msg.namespace ? { key: msg.code, params: msg.params, ns: msg.namespace } : { key: msg.code, params: msg.params };
}

export function fromLocalizedMessage(msg: LocalizedMessage): SystemMessage {
  return msg.ns ? { code: msg.key, params: msg.params, namespace: msg.ns } : { code: msg.key, params: msg.params };
}

/** @deprecated alias — prefer `LocalizedMessage` + `renderMessage`. */
export function renderSystemMessage(msg: SystemMessage, t: (key: string, params?: Record<string, JsonValue>) => string): string {
  return formatSystemMessage(msg, t);
}
