import { test, expect } from "bun:test";
import { createTuiFakeEngine } from "./helpers/fake-engine.ts";

test("fake engine query paths", () => {
  const engine = createTuiFakeEngine();
  expect(engine.query("player", "world/time")).toEqual({ day: 1, minute: 480, hhmm: "08:00" });
});

test("fake engine turn stream yields done", async () => {
  const engine = createTuiFakeEngine();
  const chunks = [];
  for await (const c of engine.scene.turn({
    sceneId: "scn_0001",
    actor: "player",
    text: "hi",
  })) {
    chunks.push(c.type);
  }
  expect(chunks).toContain("done");
});
