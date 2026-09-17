import type { Engine } from "../api.ts";
import type { TurnChunk } from "../types.ts";
import { AnimaeError } from "../types.ts";
import { INTERNAL_ERROR } from "./jsonrpc.ts";
import { paramsObject, requireString, RpcParamError } from "./params.ts";

export type RpcHandler = (params: unknown) => Promise<unknown> | unknown;

export type RpcHandlerMap = Map<string, RpcHandler>;

const BLOCKED = new Set(["rules.register", "hooks.register", "introspect.registerViewer"]);

export function buildHandlerMap(
  engine: Engine,
  opts: {
    onStreamChunk: (requestId: string | number, chunk: TurnChunk) => void;
    turnMutex: { run<T>(fn: () => Promise<T>): Promise<T> };
    replayMutex: { run<T>(fn: () => Promise<T>): Promise<T> };
  },
): RpcHandlerMap {
  const map: RpcHandlerMap = new Map();

  const bind = (name: string, fn: RpcHandler) => map.set(name, fn);

  bind("world.now", () => engine.world.now());

  bind("world.advance", async (params) => {
    const p = paramsObject(params, ["by"]);
    return engine.world.advance(p.by as never);
  });

  bind("world.set", async (params) => {
    const p = paramsObject(params, ["path", "value"]);
    return engine.world.set(requireString(p.path, "path"), p.value);
  });

  bind("world.move", async (params) => {
    const p = paramsObject(params, ["who", "location"]);
    return engine.world.move(requireString(p.who, "who"), requireString(p.location, "location"));
  });

  bind("scene.start", async (params) => {
    const p = paramsObject(params, ["location", "participants", "fields"]);
    return engine.scene.start({
      location: requireString(p.location, "location"),
      participants: p.participants as string[],
      fields: p.fields as string[] | undefined,
    });
  });

  bind("scene.end", async (params) => {
    const p = paramsObject(params, ["sceneId"]);
    return engine.scene.end(requireString(p.sceneId, "sceneId") as never);
  });

  bind("scene.active", () => engine.scene.active());

  bind("scene.turn", (params) => {
    return opts.turnMutex.run(async () => {
      const bag = params as Record<string, unknown>;
      const requestId = bag.__requestId as string | number | undefined;
      const p = paramsObject(bag, ["sceneId", "actor", "text", "addressee", "choiceId"]);
      const iter = engine.scene.turn({
        sceneId: requireString(p.sceneId, "sceneId") as never,
        actor: requireString(p.actor, "actor"),
        text: requireString(p.text, "text"),
        addressee: p.addressee as string | undefined,
        choiceId: p.choiceId as string | undefined,
      });
      return consumeTurnStream(iter, opts.onStreamChunk, requestId);
    });
  });

  bind("timeline.current", () => engine.timeline.current());

  bind("timeline.save", async (params) => {
    const p = paramsObject(params, ["label"]);
    return engine.timeline.save(p.label as string | undefined);
  });

  bind("timeline.load", async (params) => {
    const p = paramsObject(params, ["slot"]);
    return engine.timeline.load(p.slot as never);
  });

  bind("timeline.rewind", async (params) => {
    const p = paramsObject(params, ["to"]);
    return engine.timeline.rewind(requireString(p.to, "to") as never);
  });

  bind("timeline.branches", () => engine.timeline.branches());

  bind("timeline.switch", async (params) => {
    const p = paramsObject(params, ["b"]);
    return engine.timeline.switch(p.b as never);
  });

  bind("timeline.diff", async (params) => {
    const p = paramsObject(params, ["a", "b"]);
    return engine.timeline.diff(p.a as never, p.b as never);
  });

  bind("timeline.prune", async (params) => {
    const p = paramsObject(params, ["b"]);
    return engine.timeline.prune(p.b as never);
  });

  bind("timeline.export", async (params) => {
    const p = paramsObject(params, ["b", "o"]);
    return engine.timeline.export(p.b as never, p.o as never);
  });

  bind("timeline.import", async (params) => {
    const p = paramsObject(params, ["file"]);
    return engine.timeline.import(requireString(p.file, "file"));
  });

  bind("timeline.replay", (params) => {
    return opts.replayMutex.run(async () => {
      const bag = params as Record<string, unknown>;
      const requestId = bag.__requestId as string | number | undefined;
      const p = paramsObject(bag, ["b", "r"]);
      const iter = engine.timeline.replay(p.b as never, p.r as never);
      return consumeTurnStream(iter, opts.onStreamChunk, requestId);
    });
  });

  bind("timeline.saves", () => engine.timeline.saves());

  bind("timeline.events", async (params) => {
    const p = paramsObject(params, ["opts"]);
    return engine.timeline.events(p.opts as never);
  });

  bind("entities.generate", async (params) => {
    const p = paramsObject(params, ["r"]);
    return engine.entities.generate(p.r as never);
  });

  bind("entities.promote", async (params) => {
    const p = paramsObject(params, ["id", "to"]);
    return engine.entities.promote(requireString(p.id, "id"), p.to as never);
  });

  bind("fields.declare", (params) => {
    const p = paramsObject(params, ["f"]);
    engine.fields.declare(p.f as never);
    return null;
  });

  bind("fields.grant", async (params) => {
    const p = paramsObject(params, ["f"]);
    return engine.fields.grant(p.f as never);
  });

  bind("fields.revoke", async (params) => {
    const p = paramsObject(params, ["id"]);
    await engine.fields.revoke(requireString(p.id, "id"));
    return null;
  });

  bind("director.sidenote", async (params) => {
    const p = paramsObject(params, ["npc", "text", "o"]);
    await engine.director.sidenote(requireString(p.npc, "npc"), requireString(p.text, "text"), p.o as never);
    return null;
  });

  bind("director.invokeException", async (params) => {
    const p = paramsObject(params, ["id", "target"]);
    return engine.director.invokeException(requireString(p.id, "id"), requireString(p.target, "target"));
  });

  bind("query", async (params) => {
    const p = paramsObject(params, ["viewer", "path"]);
    const viewer = p.viewer as never;
    const path = requireString(p.path, "path");
    if (typeof engine.queryAsync === "function") {
      return engine.queryAsync(viewer, path);
    }
    return engine.query(viewer, path);
  });

  bind("grant", async (params) => {
    const p = paramsObject(params, ["viewer", "path", "ttl"]);
    await engine.grant(p.viewer as never, requireString(p.path, "path"), p.ttl as never);
    return null;
  });

  bind("explain", (params) => {
    const p = paramsObject(params, ["turnId", "viewer"]);
    return engine.explain(requireString(p.turnId, "turnId") as never, p.viewer as never);
  });

  bind("purge", async (params) => {
    const p = paramsObject(params, ["scope"]);
    await engine.purge(p.scope as never);
    return null;
  });

  bind("importCard", async (params) => {
    const p = paramsObject(params, ["file"]);
    return engine.importCard(requireString(p.file, "file"));
  });

  bind("exportCard", async (params) => {
    const p = paramsObject(params, ["id"]);
    return engine.exportCard(requireString(p.id, "id"));
  });

  bind("reload", () => engine.reload());

  bind("info", () => engine.info());

  for (const blocked of BLOCKED) {
    if (map.has(blocked)) map.delete(blocked);
  }

  return map;
}

async function consumeTurnStream(
  iter: AsyncIterable<TurnChunk>,
  onChunk: (requestId: string | number, chunk: TurnChunk) => void,
  requestId: string | number | undefined,
): Promise<{ events: string[]; chunks: TurnChunk[]; summary?: unknown }> {
  const chunks: TurnChunk[] = [];
  const events: string[] = [];
  let summary: unknown;
  for await (const chunk of iter) {
    chunks.push(chunk);
    if (requestId !== undefined) onChunk(requestId, chunk);
    if (chunk.type === "done") {
      events.push(...chunk.events);
      summary = { turnId: chunk.turnId, events: chunk.events, speaker: chunk.speaker };
    }
  }
  return { events, chunks, summary };
}

export function mapRpcError(err: unknown): { code: number; message: string; data?: unknown } {
  if (err instanceof RpcParamError) {
    return { code: err.rpcCode, message: err.message };
  }
  if (err instanceof AnimaeError) {
    return {
      code: INTERNAL_ERROR,
      message: err.message,
      data: { code: err.code, details: err.details },
    };
  }
  if (err instanceof Error) {
    return { code: INTERNAL_ERROR, message: err.message };
  }
  return { code: INTERNAL_ERROR, message: String(err) };
}
