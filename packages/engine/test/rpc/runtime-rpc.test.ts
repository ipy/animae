import { describe, expect, test } from "bun:test";
import { createRpcServer } from "../../src/rpc/index.ts";
import { AnimaeError } from "../../src/types.ts";
import { scriptedLlm } from "../helpers/llm-scripts.ts";
import { eventsOf, openRuleEngine, startScene } from "../helpers/rule-fixture.ts";
import { memoryDuplex } from "./duplex.ts";

type Engine = Awaited<ReturnType<typeof openRuleEngine>>["engine"];
type Chunk = { type: string; text?: string; style?: string; newParagraph?: boolean; reason?: string };
type Msg = { id?: number; method?: string; result?: any; error?: { code: number; message: string; data?: { code?: string } }; params?: any };

/** A JSON-RPC session on an in-memory line pipe: `call` sends a request and waits for its response. */
function rpc(engine: Engine) {
  const io = memoryDuplex();
  const server = createRpcServer(engine, io);
  const run = server.run();
  let next = 1;
  const messages = (): Msg[] => io.written.map((l) => JSON.parse(l) as Msg);
  const send = (method: string, params?: unknown): number => {
    const id = next++;
    io.push(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    return id;
  };
  const response = async (id: number): Promise<Msg> => {
    for (let i = 0; i < 5000; i++) {
      const m = messages().find((x) => x.id === id);
      if (m) return m;
      await new Promise((r) => setTimeout(r, 1));
    }
    throw new Error(`no response to request ${id}`);
  };
  return {
    messages,
    send,
    response,
    call: async (method: string, params?: unknown) => response(send(method, params)),
    chunks: (id: number) =>
      messages()
        .filter((m) => m.method === "turn.chunk" && m.params.requestId === id)
        .map((m) => m.params.chunk as Chunk),
    async close() {
      io.close();
      await run;
    },
  };
}

/** A promise a test can settle from outside, to hold a model call open. */
function gate(): { wait: Promise<void>; open(): void } {
  let open!: () => void;
  const wait = new Promise<void>((r) => (open = r));
  return { wait, open };
}

describe("runtime.mode / runtime.setMode over JSON-RPC", () => {
  test("`runtime.mode` reports the mode, the switch point, what is queued and the models", async () => {
    const h = await openRuleEngine({ mode: "rule" });
    const s = rpc(h.engine);
    try {
      const { result } = await s.call("runtime.mode");
      expect(result.mode).toEqual({ appraise: "rule", render: "rule" });
      expect(result.switchAt).toBe("turn_boundary");
      expect(result.pending ?? null).toBeNull();
      // a rule-only engine has no model to name
      expect(result.models).toMatchObject({ s1: "rule", s2: "rule", s1Llm: false, s2Tiers: [] });
      // `info` agrees with it
      const info = (await s.call("info")).result;
      expect(info.mode).toEqual(result.mode);
    } finally {
      await s.close();
      await h.dispose();
    }
  });

  test("`runtime.setMode` with a preset name switches an idle engine at once and writes the mode change", async () => {
    const llm = scriptedLlm();
    const h = await openRuleEngine({ models: { s1: llm.s1, s2: llm.s2 }, mode: "rule" });
    const s = rpc(h.engine);
    try {
      const res = await s.call("runtime.setMode", { mode: "full", trigger: "test:rpc" });
      expect(res.error).toBeUndefined();
      expect(res.result.before).toMatchObject({ appraise: "rule", render: "rule" });
      expect(res.result.after).toMatchObject({ appraise: "llm", render: "llm" });
      expect(res.result.pending).toBe(false);
      const mode = (await s.call("runtime.mode")).result;
      expect(mode.mode).toMatchObject({ appraise: "llm", render: "llm" });

      const sceneId = await startScene(h.engine);
      const turn = s.send("scene.turn", { sceneId, actor: "player", text: "hello", addressee: "npc1" });
      await s.response(turn);
      const changes = (await eventsOf(h.engine, "runtime.mode_changed")) as unknown as Array<{ reason: string; trigger?: string; after: unknown }>;
      // the mode the engine started in is announced first; the switch is the last change, with who asked for it
      expect(changes.at(-1)).toMatchObject({ reason: "api", trigger: "test:rpc", after: { appraise: "llm", render: "llm" } });
      expect(llm.calls.s2.length).toBeGreaterThan(0);
    } finally {
      await s.close();
      await h.dispose();
    }
  });

  test("`runtime.setMode` with an object changes one role and leaves the other", async () => {
    const llm = scriptedLlm();
    const h = await openRuleEngine({ models: { s1: llm.s1, s2: llm.s2 }, mode: "full" });
    const s = rpc(h.engine);
    try {
      const res = await s.call("runtime.setMode", { mode: { appraise: "rule" } });
      expect(res.error).toBeUndefined();
      expect(res.result.after).toMatchObject({ appraise: "rule", render: "llm" });
    } finally {
      await s.close();
      await h.dispose();
    }
  });

  test("a switch asked for during a turn is queued: the response says so, the turn finishes on the old mode, the next uses the new", async () => {
    const hold = gate();
    const llm = scriptedLlm({
      s2: async () => {
        await hold.wait;
        return undefined;
      },
    });
    const h = await openRuleEngine({ models: { s1: llm.s1, s2: llm.s2 }, mode: "full" });
    const s = rpc(h.engine);
    try {
      const sceneId = await startScene(h.engine);
      const turn = s.send("scene.turn", { sceneId, actor: "player", text: "hello", addressee: "npc1" });
      // wait until the render call is in flight
      for (let i = 0; i < 2000 && llm.calls.s2.length === 0; i++) await new Promise((r) => setTimeout(r, 1));
      expect(llm.calls.s2.length).toBe(1);

      const queued = await s.call("runtime.setMode", { mode: "rule" });
      expect(queued.error).toBeUndefined();
      expect(queued.result.after).toMatchObject({ appraise: "rule", render: "rule" });
      expect(queued.result.pending).toBe(true);
      // still the old mode while the turn runs
      const during = (await s.call("runtime.mode")).result;
      expect(during.mode).toMatchObject({ appraise: "llm", render: "llm" });
      expect(during.pending).toMatchObject({ appraise: "rule", render: "rule" });

      hold.open();
      const done = await s.response(turn);
      expect(done.error).toBeUndefined();
      // the turn that was running was rendered by the model
      expect(s.chunks(turn).some((c) => c.type === "text")).toBe(true);
      expect(llm.calls.s2.length).toBe(1);

      const after = (await s.call("runtime.mode")).result;
      expect(after.mode).toMatchObject({ appraise: "rule", render: "rule" });
      expect(after.pending ?? null).toBeNull();

      const turn2 = s.send("scene.turn", { sceneId, actor: "player", text: "again", addressee: "npc1" });
      await s.response(turn2);
      // no new model call: the second turn ran on rules
      expect(llm.calls.s2.length).toBe(1);
      expect(llm.calls.s1.length).toBe(1);
    } finally {
      hold.open();
      await s.close();
      await h.dispose();
    }
  });

  test("a mode the engine cannot serve is an error with its code, and the engine keeps its mode", async () => {
    const h = await openRuleEngine({ mode: "rule" });
    const s = rpc(h.engine);
    try {
      // no model is configured for S2: asking for `llm` is unavailable, not silently ignored
      const unavailable = await s.call("runtime.setMode", { mode: "full" });
      expect(unavailable.error?.data?.code).toBe("MODE_UNAVAILABLE");
      // a tier is never accepted unless it exists, even if the mode asked for renders on rules
      const unknownTier = await s.call("runtime.setMode", { mode: { s2Tier: "nope" } });
      expect(unknownTier.error?.data?.code).toBe("MODE_UNKNOWN_TIER");
      const invalid = await s.call("runtime.setMode", { mode: "no-such-preset" });
      expect(invalid.error?.data?.code).toBe("MODE_INVALID");
      const badParam = await s.call("runtime.setMode", { mode: 42 });
      expect(badParam.error?.code).toBe(-32602);
      const missing = await s.call("runtime.setMode", {});
      expect(missing.error?.code).toBe(-32602);

      expect((await s.call("runtime.mode")).result.mode).toEqual({ appraise: "rule", render: "rule" });
    } finally {
      await s.close();
      await h.dispose();
    }
  });
});

describe("narration and reset chunks over JSON-RPC", () => {
  test("`scene.turn` streams narration chunks (style, newParagraph) before the character's line", async () => {
    const llm = scriptedLlm({
      narrations: [
        { text: "Rain taps the glass.", style: "normal" },
        { text: "Three hours later.", style: "scene_break" },
      ],
    });
    const h = await openRuleEngine({ models: { s1: llm.s1, s2: llm.s2 }, mode: "full" });
    const s = rpc(h.engine);
    try {
      const sceneId = await startScene(h.engine);
      const id = s.send("scene.turn", { sceneId, actor: "player", text: "hello", addressee: "npc1" });
      const res = await s.response(id);
      expect(res.error).toBeUndefined();
      const chunks = s.chunks(id);
      const narration = chunks.filter((c) => c.type === "narration");
      expect(narration).toEqual([
        { type: "narration", text: "Rain taps the glass.", style: "normal", newParagraph: true },
        { type: "narration", text: "Three hours later.", style: "scene_break", newParagraph: true },
      ]);
      const types = chunks.map((c) => c.type);
      expect(types.lastIndexOf("narration")).toBeLessThan(types.lastIndexOf("text"));
      // the final result names the events the turn wrote, narration included
      const narrationEvents = (await eventsOf(h.engine, "narration")) as unknown as Array<{ id: string }>;
      for (const e of narrationEvents) expect(res.result.events).toContain(e.id);
    } finally {
      await s.close();
      await h.dispose();
    }
  });

  test("a rule-mode turn streams the same chunk types, with no model behind them", async () => {
    const h = await openRuleEngine({ mode: "rule" });
    const s = rpc(h.engine);
    try {
      const sceneId = await startScene(h.engine);
      const id = s.send("scene.turn", { sceneId, actor: "player", text: "see you later", addressee: "npc1" });
      await s.response(id);
      const narration = s.chunks(id).filter((c) => c.type === "narration");
      expect(narration.map((n) => n.style)).toEqual(["normal", "scene_break"]);
      expect(narration[1]!.text).toBe("Three hours later.");
    } finally {
      await s.close();
      await h.dispose();
    }
  });

  test("a render that fails mid-stream sends `reset` before the rule backend's replacement", async () => {
    const llm = scriptedLlm({
      s2: () => {
        throw new AnimaeError("MODEL_UNREACHABLE", "connection dropped");
      },
    });
    const h = await openRuleEngine({
      models: { s1: llm.s1, s2: llm.s2 },
      mode: "full",
      yaml: "runtime:\n  fallbackOnError:\n    render: true",
    });
    const s = rpc(h.engine);
    try {
      const sceneId = await startScene(h.engine);
      const id = s.send("scene.turn", { sceneId, actor: "player", text: "hello", addressee: "npc1" });
      const res = await s.response(id);
      expect(res.error).toBeUndefined();
      // nothing had streamed when the call failed, so there is nothing to void: no `reset`
      expect(s.chunks(id).some((c) => c.type === "reset")).toBe(false);
      expect(s.chunks(id).at(-1)?.type).toBe("done");
      expect(((await eventsOf(h.engine, "runtime.fallback_used"))[0] as unknown as { phase: string }).phase).toBe("render");
    } finally {
      await s.close();
      await h.dispose();
    }
  });
});
