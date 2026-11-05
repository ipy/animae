import { test, expect } from "bun:test";
import { createRpcServer } from "../../src/rpc/index.ts";
import { AnimaeError } from "../../src/types.ts";
import { memoryDuplex } from "./duplex.ts";
import { createFakeEngine } from "./fake-engine.ts";

function parseLines(written: string[]): unknown[] {
  return written.map((l) => JSON.parse(l));
}

test("JSON-RPC info and query", async () => {
  const io = memoryDuplex();
  const engine = createFakeEngine();
  const server = createRpcServer(engine, io);
  const run = server.run();
  io.push(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "info" }));
  io.push(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "query", params: { viewer: "player", path: "world.time" } }));
  io.close();
  await run;
  const msgs = parseLines(io.written);
  expect(msgs[0]).toMatchObject({ id: 1, result: { branch: "main" } });
  expect(msgs[1]).toMatchObject({ id: 2, result: { ok: true } });
});

test("unknown method returns -32601", async () => {
  const io = memoryDuplex();
  const server = createRpcServer(createFakeEngine(), io);
  const run = server.run();
  io.push(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "rules.register" }));
  io.close();
  await run;
  expect(io.written[0]).toContain('"code":-32601');
});

test("blocked hook and introspect registrars return -32601", async () => {
  for (const method of ["hooks.register", "introspect.registerViewer"] as const) {
    const io = memoryDuplex();
    const server = createRpcServer(createFakeEngine(), io);
    const run = server.run();
    io.push(JSON.stringify({ jsonrpc: "2.0", id: 1, method }));
    io.close();
    await run;
    expect(io.written[0]).toContain('"code":-32601');
  }
});

test("parse error", async () => {
  const io = memoryDuplex();
  const server = createRpcServer(createFakeEngine(), io);
  const run = server.run();
  io.push("{not json");
  io.close();
  await run;
  const msg = JSON.parse(io.written[0]!);
  expect(msg.error.code).toBe(-32700);
});

test("scene.turn streams turn.chunk notifications", async () => {
  const io = memoryDuplex();
  const server = createRpcServer(createFakeEngine(), io);
  const run = server.run();
  io.push(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 9,
      method: "scene.turn",
      params: { sceneId: "scn_0001", actor: "player", text: "hello" },
    }),
  );
  io.close();
  await run;
  const msgs = parseLines(io.written);
  const chunks = msgs.filter((m) => (m as { method?: string }).method === "turn.chunk");
  expect(chunks.length).toBeGreaterThanOrEqual(2);
  const final = msgs.find((m) => (m as { id?: number }).id === 9);
  expect(final).toMatchObject({ result: { events: ["evt_0002"] } });
});

test("AnimaeError maps to error.data.code", async () => {
  const io = memoryDuplex();
  const engine = createFakeEngine({
    world: {
      now: () => ({ day: 1, minute: 0 }),
      advance: async () => {
        throw new AnimaeError("TIME_BACKWARDS", "nope");
      },
      set: async () => ({} as never),
      move: async () => ({} as never),
    },
  });
  const server = createRpcServer(engine, io);
  const run = server.run();
  io.push(JSON.stringify({ jsonrpc: "2.0", id: 3, method: "world.advance", params: { by: "1h" } }));
  io.close();
  await run;
  const msg = JSON.parse(io.written[0]!);
  expect(msg.error.data.code).toBe("TIME_BACKWARDS");
});

test("subscribe emits event notifications", async () => {
  const io = memoryDuplex();
  const engine = createFakeEngine();
  const server = createRpcServer(engine, io);
  const run = server.run();
  io.push(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "subscribe", params: { kinds: ["world.moved"] } }));
  await new Promise((r) => setTimeout(r, 5));
  await engine.world.move("player", "tavern");
  io.close();
  await run;
  const msgs = parseLines(io.written);
  expect(msgs.some((m) => (m as { method?: string }).method === "event")).toBe(true);
});

test("concurrent scene.turn calls are serialised", async () => {
  const io = memoryDuplex();
  let active = 0;
  let maxActive = 0;
  const engine = createFakeEngine({
    scene: {
      start: async () => "scn_0001",
      end: async () => ({ sceneId: "scn_0001", turns: 0, events: 0, reflections: [], anchors: [] }),
      active: () => null,
      turn: async function* () {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 20));
        active--;
        yield { type: "done", turnId: "turn_0001", events: [] };
      },
    },
  });
  const server = createRpcServer(engine, io);
  const run = server.run();
  io.push(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "scene.turn", params: { sceneId: "s", actor: "a", text: "t" } }));
  io.push(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "scene.turn", params: { sceneId: "s", actor: "a", text: "t2" } }));
  io.close();
  await run;
  expect(maxActive).toBe(1);
});
