import { describe, expect, test } from "bun:test";
import type { StageHook } from "../../src/contracts.ts";
import type { TurnChunk } from "../../src/types.ts";
import { scriptedLlm } from "../helpers/llm-scripts.ts";
import { collectTurn, openSessionEngine } from "./session-fixture.ts";

const REPLY = "The tavern is warm tonight.";

/** One turn on a scripted S2 reply, with an optional `render` stage hook registered first. */
async function turnWith(renderHook?: StageHook) {
  const llm = scriptedLlm({
    s2: (req) => (req.label === "render" ? { text: REPLY, cues: [], intent_realized: "talk" } : undefined),
  });
  const h = await openSessionEngine({ models: { s1: llm.s1, s2: llm.s2 }, mode: "full" });
  try {
    if (renderHook) h.engine.hooks.register("render", renderHook);
    const sceneId = await h.engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
    const { chunks } = await collectTurn(h.engine.scene.turn({ sceneId, actor: "player", text: "hello there", addressee: "npc1" }));
    const events = await h.engine.timeline.events();
    const utterance = events.find((e) => e.kind === "utterance" && (e as { speaker?: string }).speaker === "npc1") as
      | { text?: string }
      | undefined;
    await h.engine.scene.end(sceneId);
    await h.audit({ snapshots: false });
    return { chunks, kinds: events.map((e) => e.kind), committed: utterance?.text, renderCalls: llm.calls.s2.filter((l) => l === "render").length };
  } finally {
    await h.dispose();
  }
}

/** What the characters said, as the consumer was shown it. */
const shown = (chunks: TurnChunk[]): string =>
  chunks.flatMap((c) => (c.type === "text" && c.speaker === "npc1" ? [c.text] : [])).at(-1) ?? "";

describe("render stage hook", () => {
  test("a hook that passes the render through changes nothing the consumer or the log sees", async () => {
    const plain = await turnWith();
    const hooked = await turnWith((_ctx, next) => next());
    expect(shown(plain.chunks)).toBe(REPLY);
    expect(shown(hooked.chunks)).toBe(REPLY);
    expect(hooked.committed).toBe(plain.committed);
    expect(hooked.chunks.map((c) => c.type)).toEqual(plain.chunks.map((c) => c.type));
    expect(hooked.kinds).toEqual(plain.kinds);
    expect(hooked.renderCalls).toBe(1);
  });

  test("a hook that rewrites the finished render decides what is shown and what is committed", async () => {
    const out = await turnWith(async (_ctx, next) => {
      const rendered = (await next()) as { result: { text: string }; parts: { type: string; text?: string }[] };
      return {
        result: { ...rendered.result, text: rendered.result.text.toUpperCase() },
        parts: rendered.parts.map((p) => (p.type === "text" ? { ...p, text: p.text!.toUpperCase() } : p)),
      };
    });
    expect(shown(out.chunks)).toBe(REPLY.toUpperCase());
    expect(out.committed).toBe(REPLY.toUpperCase());
    expect(out.chunks.at(-1)?.type).toBe("done");
  });

  test("nothing of the reply is streamed before the hook has run", async () => {
    const llm = scriptedLlm({
      s2: (req) => (req.label === "render" ? { text: REPLY, cues: [], intent_realized: "talk" } : undefined),
    });
    const h = await openSessionEngine({ models: { s1: llm.s1, s2: llm.s2 }, mode: "full" });
    try {
      const sceneId = await h.engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      let replyChunks = 0;
      let replyChunksWhenHookReturned = -1;
      h.engine.hooks.register("render", async (_ctx, next) => {
        const out = await next();
        // The model has finished writing, yet the consumer has not been given one character of the reply.
        replyChunksWhenHookReturned = replyChunks;
        return out;
      });
      for await (const c of h.engine.scene.turn({ sceneId, actor: "player", text: "hello there", addressee: "npc1" })) {
        if (c.type === "text" && c.speaker === "npc1") replyChunks += 1;
      }
      expect(replyChunksWhenHookReturned).toBe(0);
      expect(replyChunks).toBeGreaterThan(0);
    } finally {
      await h.dispose();
    }
  });
});
