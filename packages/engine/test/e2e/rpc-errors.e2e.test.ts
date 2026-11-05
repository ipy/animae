import { describe, expect, test } from "bun:test";
import { createEngine, createRpcServer, createScriptedModel } from "../../src/index.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { e2ePreset, seedE2eAuthored } from "./fixture.ts";
import { FsStorage } from "../../src/store/fs.ts";
import { createRpcLineSession, memoryDuplex, openRpcRuleEngine } from "./rpc-fixture.ts";
import { AnimaeError } from "../../src/types.ts";

describe("JSON-RPC error handling e2e", () => {
  test("parse error, invalid request, unknown and blocked methods, invalid params, engine errors, EOF, long line, batch", async () => {
    const h = await openRpcRuleEngine();
    const rpc = createRpcLineSession(h.engine);
    try {
      rpc.sendRaw("{not-json\n");
      await new Promise((r) => setTimeout(r, 30));
      expect(rpc.messages().some((m) => m.error?.code === -32700)).toBe(true);

      rpc.sendRaw(`${JSON.stringify({ jsonrpc: "2.0", method: "info" })}\n`);
      await new Promise((r) => setTimeout(r, 30));
      expect(rpc.messages().some((m) => m.error?.code === -32600)).toBe(true);

      const unknown = await rpc.call("no.such.method");
      expect(unknown.error?.code).toBe(-32601);

      for (const blocked of ["close", "rules.register", "hooks.register", "introspect.registerViewer"] as const) {
        const msg = await rpc.call(blocked, {});
        expect(msg.error?.code).toBe(-32601);
      }

      const badQuery = await rpc.call("query", { viewer: "player", path: 99 });
      expect(badQuery.error?.code).toBe(-32602);
      expect(badQuery.error!.message.length).toBeGreaterThan(0);

      const badTurn = await rpc.call("scene.turn", { sceneId: "scn_missing", actor: "player", text: "x" });
      expect(badTurn.error?.code).toBe(-32603);
      expect(badTurn.error?.data?.code).toBeDefined();
    } finally {
      await rpc.close();
      await h.dispose();
    }

    const dir = await mkdtemp(join(tmpdir(), "animae-rpc-err-"));
    try {
      await seedE2eAuthored(FsStorage(dir));
      const model = createScriptedModel("rpc-err", () => ({}));
      const engine = await createEngine({
        root: dir,
        presets: [e2ePreset],
        models: { s1: model, s2: model },
      });
      const wrapped = Object.assign(engine, {
        world: {
          ...engine.world,
          advance: async () => {
            throw new AnimaeError("TIME_BACKWARDS", "cannot go back");
          },
        },
      });

      const io = memoryDuplex();
      const server = createRpcServer(wrapped, io);
      const run = server.run();
      io.push(JSON.stringify({ jsonrpc: "2.0", id: 7, method: "world.advance", params: { by: "1h" } }));
      io.close();
      await run;
      const mapped = JSON.parse(io.written.find((l) => l.includes('"id":7'))!);
      expect(mapped.error.data.code).toBe("TIME_BACKWARDS");

      const eofIo = memoryDuplex();
      const eofServer = createRpcServer(engine, eofIo);
      const eofRun = eofServer.run();
      eofIo.push(JSON.stringify({ jsonrpc: "2.0", id: 8, method: "info" }));
      eofIo.close();
      await eofRun;
      expect(eofIo.written.some((l) => l.includes('"id":8'))).toBe(true);

      const longIo = memoryDuplex();
      const longServer = createRpcServer(engine, longIo);
      const longRun = longServer.run();
      const pad = "x".repeat(512 * 1024);
      longIo.push(JSON.stringify({ jsonrpc: "2.0", id: 9, method: "display.resolve", params: { value: pad } }));
      longIo.close();
      await longRun;
      expect(longIo.written.some((l) => l.includes('"id":9'))).toBe(true);

      const batchIo = memoryDuplex();
      const batchServer = createRpcServer(engine, batchIo);
      const batchRun = batchServer.run();
      batchIo.push(JSON.stringify([{ jsonrpc: "2.0", id: 1, method: "info" }]));
      batchIo.close();
      await batchRun;
      const batchParsed = JSON.parse(batchIo.written[0]!);
      expect(batchParsed.error?.code).toBe(-32600);

      await engine.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
