#!/usr/bin/env bun
/** Dev-only demo: run TUI against test fake engine. */
import { runTui } from "../src/run-tui.ts";
import { createTuiFakeEngine } from "../test/helpers/fake-engine.ts";

const engine = createTuiFakeEngine();

await runTui({
  engine,
  viewer: "player",
  actor: "player",
  scene: { sceneId: "scn_0001" },
  initialMessage: "Demo mode — fake engine. Try :help or press F1.",
});
