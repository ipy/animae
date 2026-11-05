import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { StdioRpcClient, killCliProcess, spawnCliInteractive, scrubNetworkEnv } from "./cli-process.ts";
import { freshRuleRoot, playArgs } from "./e2e-shared.ts";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

function eventSeq(id: string): number {
  return parseInt(id.replace(/\D/g, ""), 10) || 0;
}

test("serve --stdio JSON-RPC journey and clean shutdown", async () => {
  const { dir, cleanup } = await freshRuleRoot();
  cleanups.push(cleanup);

  const proc = spawnCliInteractive(playArgs(dir, ["serve", "--stdio"]), scrubNetworkEnv());
  const rpc = new StdioRpcClient(proc);
  try {
    const info = await rpc.request("info");
    expect(info.result).toMatchObject({ mode: { appraise: "rule", render: "rule" }, branch: "main" });

    const sceneId = (await rpc.request("scene.start", { location: "home", participants: ["player"] })).result as string;
    const turn = await rpc.request("scene.turn", { sceneId, actor: "player", text: "ping" });
    expect(turn.error).toBeUndefined();
    const chunks = (turn.result as { chunks: { type: string }[] }).chunks.map((c) => c.type);
    expect(chunks).toContain("text");
    expect(chunks.at(-1)).toBe("done");
    expect(rpc.notifications.some((n) => n.method === "turn.chunk")).toBe(true);

    expect((await rpc.request("query", { viewer: "player", path: "world/location" })).error).toBeUndefined();
    expect((await rpc.request("query", { viewer: "debug", path: "world/location" })).error).toBeUndefined();

    const turnId = (turn.result as { summary?: { turnId?: string } }).summary?.turnId;
    if (turnId) {
      expect((await rpc.request("explain", { turnId, viewer: "debug" })).error).toBeUndefined();
    }

    expect((await rpc.request("timeline.current")).error).toBeUndefined();
    expect((await rpc.request("mods", {})).error).toBeUndefined();
    expect(
      (await rpc.request("display.entityDisplayName", { entityId: "player", opts: { viewer: "player" } })).error,
    ).toBeUndefined();
    const turnEvents = await rpc.request("timeline.events", { opts: { limit: 50 } });
    const evList = turnEvents.result as { id: string; kind: string }[];
    expect(evList.some((e) => e.kind === "input.received")).toBe(true);

    await rpc.request("timeline.saves");
    expect((await rpc.request("setUiLocale", { locale: "en" })).error).toBeUndefined();
    expect(
      (await rpc.request("entities.setAlias", { input: { entity: "player", nickname: "E2E", by: "player" } })).error,
    ).toBeUndefined();

    expect((await rpc.request("rules.register", {})).error?.code).toBe(-32601);
    expect((await rpc.request("hooks.register", {})).error?.code).toBe(-32601);
    expect((await rpc.request("introspect.registerViewer", {})).error?.code).toBe(-32601);
    expect((await rpc.request("nope.method", {})).error?.code).toBe(-32601);

    rpc.write("{ broken\n");
    const parseErr = await rpc.readLine();
    expect(parseErr?.error?.code).toBe(-32700);

    rpc.endStdin();
    expect(await rpc.drainExit()).toBe(0);
    const errText =
      proc.stderr && typeof proc.stderr !== "number" ? await new Response(proc.stderr).text() : "";
    expect(errText).toBe("");
    expect(evList.length).toBeGreaterThan(2);
  } finally {
    killCliProcess(proc);
  }
}, 15_000);

test("second serve on same root continues event seq (I1)", async () => {
  const { dir, cleanup } = await freshRuleRoot();
  cleanups.push(cleanup);

  const proc1 = spawnCliInteractive(playArgs(dir, ["--seed", "42", "serve", "--stdio"]));
  const rpc1 = new StdioRpcClient(proc1);
  let firstIds: string[] = [];
  try {
    const sceneId = (await rpc1.request("scene.start", { location: "home", participants: ["player"] })).result as string;
    await rpc1.request("scene.turn", { sceneId, actor: "player", text: "persist me" });
    const ev = await rpc1.request("timeline.events", {});
    const events = ev.result as { id: string; kind: string; payload?: { text?: string } }[];
    firstIds = events.map((e) => e.id);
    expect(events.some((e) => e.kind === "input.received")).toBe(true);
    rpc1.endStdin();
    expect(await rpc1.drainExit()).toBe(0);
  } finally {
    killCliProcess(proc1);
  }

  const proc2 = spawnCliInteractive(playArgs(dir, ["--seed", "42", "serve", "--stdio"]));
  const rpc2 = new StdioRpcClient(proc2);
  try {
    const ev2 = await rpc2.request("timeline.events", {});
    const events2 = ev2.result as { id: string; kind: string; payload?: { text?: string } }[];
    // The log the first process wrote is the prefix of what the second process reads.
    expect(events2.slice(0, firstIds.length).map((e) => e.id)).toEqual(firstIds);
    expect(JSON.stringify(events2)).toContain("persist me");

    const active = await rpc2.request("scene.active", {});
    expect(active.error).toBeUndefined();
    const open = active.result as { id: string } | null;
    expect(open?.id).toBeDefined();
    const sceneId =
      (await rpc2.request("scene.start", { location: "home", participants: ["player"] })).result ??
      open!.id;
    expect(typeof sceneId).toBe("string");
    const turn2 = await rpc2.request("scene.turn", { sceneId, actor: "player", text: "second process turn" });
    expect(turn2.error).toBeUndefined();
    const ev3 = await rpc2.request("timeline.events", {});
    const after = ev3.result as { id: string; kind: string }[];
    expect(after.length).toBeGreaterThan(events2.length);
    expect(JSON.stringify(after)).toContain("second process turn");

    // I1: the second process continues the id sequence instead of restarting it.
    const lastSeqBefore = events2.reduce((m, e) => Math.max(m, eventSeq(e.id)), 0);
    const added = after.slice(events2.length).map((e) => eventSeq(e.id));
    expect(added.length).toBeGreaterThan(0);
    expect(added[0]!).toBeGreaterThan(lastSeqBefore);
    expect(added).toEqual([...added].sort((a, b) => a - b));
    expect(new Set(after.map((e) => e.id)).size).toBe(after.length);

    rpc2.endStdin();
    expect(await rpc2.drainExit()).toBe(0);
  } finally {
    killCliProcess(proc2);
  }

  const log = await readFile(join(dir, "timelines/main/events.jsonl"), "utf8");
  expect(log).toContain("persist me");
  expect(log).toContain("second process turn");
}, 15_000);
