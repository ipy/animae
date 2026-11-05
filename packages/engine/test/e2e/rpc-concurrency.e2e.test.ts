import { describe, expect, test } from "bun:test";
import { createScriptedModel } from "../../src/model/scripted.ts";
import { startScene } from "../helpers/rule-fixture.ts";
import { createRpcLineSession, openRpcRuleEngine } from "./rpc-fixture.ts";

function gate(): { wait: Promise<void>; open(): void } {
  let open!: () => void;
  const wait = new Promise<void>((r) => (open = r));
  return { wait, open };
}

describe("JSON-RPC concurrency e2e", () => {
  test("overlapping scene.turn requests serialize; responses match request ids", async () => {
    const hold = gate();
    const llm = {
      s1: createScriptedModel("conc/s1", async (req) => {
        if (req.label === "appraise") {
          await hold.wait;
          return {
            type: "chat",
            intensity: 0.4,
            sincerity: 0.8,
            claims: [],
            search_terms: [],
            tags: [],
            input_class: "normal",
          };
        }
        return {};
      }),
      s2: createScriptedModel("conc/s2", async () => ({ text: "ok.", cues: [], intent_realized: "talk" })),
    };
    const h = await openRpcRuleEngine({ mode: "full", models: llm });
    const rpc = createRpcLineSession(h.engine);
    try {
      const sceneId = await startScene(h.engine);
      const id1 = rpc.send("scene.turn", { sceneId, actor: "player", text: "first", addressee: "npc1" });
      const id2 = rpc.send("scene.turn", { sceneId, actor: "player", text: "second", addressee: "npc1" });
      hold.open();
      const [res1, res2] = await Promise.all([rpc.response(id1), rpc.response(id2)]);
      expect(res1.id).toBe(id1);
      expect(res2.id).toBe(id2);
      expect(res1.error).toBeUndefined();
      expect(res2.error).toBeUndefined();
      // Serialized: the second turn starts only after the first one ended, and the inputs keep their send order.
      const events = await h.engine.timeline.events();
      expect(events.filter((e) => e.kind === "turn.started" || e.kind === "turn.ended").map((e) => e.kind)).toEqual([
        "turn.started",
        "turn.ended",
        "turn.started",
        "turn.ended",
      ]);
      expect(
        events.filter((e) => e.kind === "input.received").map((e) => (e as { text?: string }).text),
      ).toEqual(["first", "second"]);
      /*
       * Design note (open question): independent non-turn RPC requests are handled concurrently and may complete
       * out of order relative to send order; only scene.turn / timeline.replay hold the mutation mutex. Clients must
       * always correlate responses by JSON-RPC id (see docs/rpc-reference.md).
       */
    } finally {
      await rpc.close();
      await h.dispose();
    }
  });
});
