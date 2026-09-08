import type { FormatParams } from "./types.ts";

/** Minimal error shape for host/web edges (matches {@link AnimaeError} presentation fields). */
export interface LocalizableError {
  message: string;
  code?: string;
  messageKey?: string;
  params?: Record<string, unknown>;
  messageNamespace?: string;
  localizedMessage?(t: (key: string, params?: FormatParams) => string): string;
}

export function localizeError(
  err: unknown,
  t: (key: string, params?: FormatParams) => string,
): string {
  if (err && typeof err === "object") {
    const e = err as LocalizableError;
    if (typeof e.localizedMessage === "function") return e.localizedMessage(t);
    if (e.messageKey) {
      const key = e.messageNamespace ? `${e.messageNamespace}:${e.messageKey}` : e.messageKey;
      return t(key, e.params as FormatParams | undefined);
    }
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
