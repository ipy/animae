export const JSONRPC_VERSION = "2.0" as const;

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc: typeof JSONRPC_VERSION;
  id?: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: typeof JSONRPC_VERSION;
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccess {
  jsonrpc: typeof JSONRPC_VERSION;
  id: JsonRpcId;
  result: unknown;
}

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcError {
  jsonrpc: typeof JSONRPC_VERSION;
  id: JsonRpcId;
  error: JsonRpcErrorObject;
}

export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
export const INTERNAL_ERROR = -32603;

export function isRequest(msg: unknown): msg is JsonRpcRequest {
  if (msg == null || typeof msg !== "object") return false;
  const m = msg as Record<string, unknown>;
  return m.jsonrpc === JSONRPC_VERSION && typeof m.method === "string" && "id" in m;
}

export function isNotification(msg: unknown): msg is JsonRpcNotification {
  if (msg == null || typeof msg !== "object") return false;
  const m = msg as Record<string, unknown>;
  return m.jsonrpc === JSONRPC_VERSION && typeof m.method === "string" && !("id" in m);
}

export function serializeLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}
