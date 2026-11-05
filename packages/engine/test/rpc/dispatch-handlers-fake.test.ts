import { test, expect } from "bun:test";
import { createRpcServer } from "../../src/rpc/index.ts";
import { memoryDuplex } from "./duplex.ts";
import { createFakeEngine } from "./fake-engine.ts";

async function rpc(method: string, params?: unknown): Promise<unknown> {
  const io = memoryDuplex();
  const server = createRpcServer(createFakeEngine(), io);
  const run = server.run();
  io.push(JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params ?? {} }));
  io.close();
  await run;
  const lines = io.written.map((l) => JSON.parse(l) as { id?: number; result?: unknown; error?: unknown });
  return lines.find((l) => l.id === 1);
}

test("dispatch handlers smoke on fake engine", async () => {
  const calls: Array<[string, unknown?]> = [
    ["world.now"],
    ["world.advance", { by: "1h" }],
    ["world.set", { path: "x", value: 1 }],
    ["world.move", { who: "player", location: "tavern" }],
    ["scene.start", { location: "home", participants: ["player"] }],
    ["scene.active"],
    ["scene.end", { sceneId: "scn_0001" }],
    ["scene.turn", { sceneId: "scn_0001", actor: "player", text: "hi", outputLocale: "en" }],
    ["timeline.current"],
    ["timeline.save", { label: "s1" }],
    ["timeline.load", { slot: "s1" }],
    ["timeline.rewind", { to: "evt_0001" }],
    ["timeline.switch", { b: "main" }],
    ["timeline.diff", { a: "main", b: "main" }],
    ["timeline.prune", { b: "main" }],
    ["timeline.export", { b: "main", o: { recordings: false } }],
    ["timeline.import", { file: "/tmp/timeline.json" }],
    ["timeline.replay", { b: "main", r: {} }],
    ["timeline.branches"],
    ["timeline.saves"],
    ["timeline.events", { opts: { limit: 1 } }],
    ["entities.generate", { r: { kind: "character", template: "t" } }],
    ["entities.promote", { id: "npc1", to: "principal" }],
    ["entities.setAlias", { input: { entity: "npc1", alias: "a", by: "player" } }],
    ["entities.spawn", { spec: { kind: "character", template: "t" } }],
    ["entities.retire", { ref: "npc1" }],
    ["entities.generateFromBrief", { brief: { kind: "character", template: "t", hints: {} } }],
    ["fields.declare", { f: { id: "f1", name: "F", level: "L0", holder: { kind: "character", ref: "player" }, effects: {} } }],
    ["fields.grant", { f: { id: "f1", name: "F", level: "L0", holder: { kind: "character", ref: "player" }, effects: {} } }],
    ["fields.revoke", { id: "f1" }],
    ["director.sidenote", { npc: "npc1", text: "psst" }],
    ["director.invokeException", { id: "ex1", target: "npc1" }],
    ["query", { viewer: "player", path: "world/time" }],
    ["grant", { viewer: "player", path: "ledger", ttl: "1h" }],
    ["revoke", { viewer: "player", path: "ledger" }],
    ["explain", { turnId: "turn_0001", viewer: "player" }],
    ["purge", { scope: {} }],
    ["importCard", { file: "/tmp/c.json" }],
    ["exportCard", { id: "npc1" }],
    ["reload"],
    ["setUiLocale", { locale: "en" }],
    ["display.resolve", { value: { i18n: "x" } }],
    ["display.entityDisplayName", { entityId: "player" }],
    ["mods"],
    ["info"],
    ["runtime.mode"],
    ["runtime.setMode", { mode: "rule" }],
    ["gallery.list"],
    ["gallery.get", { id: "g1" }],
    ["gallery.ratings"],
    ["gallery.unlock", { id: "g1" }],
    ["gallery.capture", { req: {} }],
    ["gallery.render", { id: "g1" }],
    ["gallery.cancel", { job: "job1" }],
    ["gallery.remove", { id: "g1" }],
    ["gallery.pin", { id: "g1", pinned: true }],
    ["gallery.jobs"],
    ["gallery.image", { id: "g1" }],
  ];

  for (const [method, params] of calls) {
    const msg = (await rpc(method, params)) as { error?: { code: number } };
    expect(msg?.error?.code).not.toBe(-32601);
  }
});
