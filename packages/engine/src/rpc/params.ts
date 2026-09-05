import { INVALID_PARAMS } from "./jsonrpc.ts";

export class RpcParamError extends Error {
  readonly rpcCode = INVALID_PARAMS;
  constructor(message: string) {
    super(message);
    this.name = "RpcParamError";
  }
}

/** Positional array or named object → plain object for handlers. */
export function paramsObject(params: unknown, names: readonly string[]): Record<string, unknown> {
  if (params === undefined) return {};
  if (Array.isArray(params)) {
    const out: Record<string, unknown> = {};
    for (let i = 0; i < names.length; i++) {
      if (i < params.length) out[names[i]!] = params[i];
    }
    return out;
  }
  if (params != null && typeof params === "object" && !Array.isArray(params)) {
    return { ...(params as Record<string, unknown>) };
  }
  throw new RpcParamError("params must be an array or object");
}

export function requireString(v: unknown, label: string): string {
  if (typeof v !== "string" || !v.trim()) throw new RpcParamError(`${label} must be a non-empty string`);
  return v;
}

export function optionalString(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw new RpcParamError("expected string");
  return v;
}
