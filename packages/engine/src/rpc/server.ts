import type { Engine } from "../api.ts";
import { EVENT_KINDS } from "../events.ts";
import type { EngineEvent } from "../types.ts";
import { buildHandlerMap, mapRpcError } from "./dispatch.ts";
import {
  INVALID_REQUEST,
  isNotification,
  isRequest,
  METHOD_NOT_FOUND,
  PARSE_ERROR,
  serializeLine,
  type JsonRpcError,
  type JsonRpcId,
  type JsonRpcSuccess,
} from "./jsonrpc.ts";
import { readLines } from "./line-io.ts";
import { createMutex } from "./mutex.ts";
import { paramsObject } from "./params.ts";

export interface RpcIo {
  read: AsyncIterable<string | Uint8Array>;
  write(line: string): void;
}

export interface RpcServer {
  run(): Promise<void>;
  close(): void;
}

export function createRpcServer(engine: Engine, io: RpcIo): RpcServer {
  let closed = false;
  const turnMutex = createMutex();
  const replayMutex = createMutex();

  const subscriptionKinds = new Set<string>();
  const unsubEngine: (() => void)[] = [];

  const notify = (method: string, params: unknown) => {
    io.write(serializeLine({ jsonrpc: "2.0", method, params }));
  };

  const resyncSubscriptions = () => {
    for (const u of unsubEngine) u();
    unsubEngine.length = 0;
    if (!subscriptionKinds.size) return;
    const wantAll = subscriptionKinds.has("*");
    const kinds = wantAll ? [...EVENT_KINDS] : [...subscriptionKinds];
    for (const kind of kinds) {
      const offKind = engine.on(kind, (e: EngineEvent) => {
        notify("event", { kind: e.kind, event: e });
      });
      unsubEngine.push(offKind);
    }
  };

  const handlers = buildHandlerMap(engine, {
    turnMutex,
    replayMutex,
    onStreamChunk: (requestId, chunk) => {
      notify("turn.chunk", { requestId, chunk });
    },
  });

  handlers.set("subscribe", (params) => {
    const p = paramsObject(params, ["kinds"]);
    const kinds = p.kinds;
    if (!Array.isArray(kinds) || !kinds.every((k) => typeof k === "string")) {
      throw new Error("kinds must be string[]");
    }
    subscriptionKinds.clear();
    for (const k of kinds) subscriptionKinds.add(k);
    resyncSubscriptions();
    return null;
  });

  handlers.set("unsubscribe", () => {
    subscriptionKinds.clear();
    for (const u of unsubEngine) u();
    unsubEngine.length = 0;
    return null;
  });

  const respondError = (id: JsonRpcId, code: number, message: string, data?: unknown) => {
    const body: JsonRpcError = { jsonrpc: "2.0", id, error: { code, message, data } };
    io.write(serializeLine(body));
  };

  const respondOk = (id: JsonRpcId, result: unknown) => {
    const body: JsonRpcSuccess = { jsonrpc: "2.0", id, result };
    io.write(serializeLine(body));
  };

  const handleMessage = async (raw: string) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      respondError(null, PARSE_ERROR, "Parse error");
      return;
    }

    if (isNotification(parsed)) {
      if (parsed.method === "ping") return;
      respondError(null, INVALID_REQUEST, "Notifications are not accepted from client");
      return;
    }

    if (!isRequest(parsed)) {
      respondError(null, INVALID_REQUEST, "Invalid Request");
      return;
    }

    const { id, method } = parsed;
    if (id === undefined) {
      respondError(null, INVALID_REQUEST, "Request must include id");
      return;
    }

    const handler = handlers.get(method);
    if (!handler) {
      respondError(id, METHOD_NOT_FOUND, `Method not found: ${method}`);
      return;
    }

    try {
      const params =
        parsed.params !== undefined && parsed.params !== null
          ? Array.isArray(parsed.params)
            ? [...parsed.params]
            : typeof parsed.params === "object"
              ? { ...(parsed.params as Record<string, unknown>), __requestId: id }
              : parsed.params
          : { __requestId: id };

      const result = await handler(params);
      respondOk(id, result ?? null);
    } catch (err) {
      const mapped = mapRpcError(err);
      respondError(id, mapped.code, mapped.message, mapped.data);
    }
  };

  return {
    async run() {
      const pending = new Set<Promise<void>>();
      const track = (p: Promise<void>) => {
        pending.add(p);
        void p.finally(() => pending.delete(p));
      };
      for await (const line of readLines(io.read)) {
        if (closed) break;
        track(handleMessage(line));
      }
      await Promise.all([...pending]);
    },
    close() {
      closed = true;
      for (const u of unsubEngine) u();
      unsubEngine.length = 0;
    },
  };
}
