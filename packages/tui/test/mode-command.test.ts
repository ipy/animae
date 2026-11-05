import { describe, expect, test } from "bun:test";
import { runCommandLine } from "../src/commands/builtin.ts";
import { createTuiI18n } from "../src/i18n/tui-i18n.ts";
import type { CommandApi } from "../src/types.ts";
import { createTuiFakeEngineControls, type FakeRuntimeOptions } from "./helpers/fake-engine.ts";

const tiers = {
  s2Tiers: [
    { id: "std", model: "writer/std", tags: [] },
    { id: "pro", model: "writer/pro", tags: [] },
  ],
  s2Default: "std",
};

function setup(runtime: FakeRuntimeOptions = {}) {
  const controls = createTuiFakeEngineControls({}, { models: tiers, ...runtime });
  const i18n = createTuiI18n("en");
  const notes: Array<{ text: string; level?: string }> = [];
  const overlays: string[] = [];
  const api = {
    engine: controls.engine,
    viewer: "player",
    actor: "player",
    sceneId: () => undefined,
    notify: (text: string, level?: string) => notes.push({ text, level }),
    openOverlay: (name: string) => overlays.push(name),
    t: (key: string, params?: Record<string, string | number>) => i18n.t(key, params, { ns: "tui" }),
  } as unknown as CommandApi;
  const run = (line: string) => runCommandLine(line, api, {});
  return { ...controls, notes, overlays, run };
}

describe(":mode", () => {
  test("opens the mode panel when called bare", async () => {
    const { run, overlays } = setup();
    await run(":mode");
    expect(overlays).toEqual(["mode"]);
  });

  test("switches to a preset and the engine reports the new mode", async () => {
    const { run, engine, notes } = setup();
    await run(":mode rule");
    expect(engine.runtime.mode()).toMatchObject({ appraise: "rule", render: "rule" });
    // the change itself is announced by the runtime.mode_changed event, not by the command
    expect(notes).toEqual([]);
  });

  test("switches one role at a time", async () => {
    const { run, engine } = setup();
    await run(":mode s2 rule");
    expect(engine.runtime.mode()).toMatchObject({ appraise: "llm", render: "rule" });
    await run(":mode s1 rule");
    expect(engine.runtime.mode()).toMatchObject({ appraise: "rule", render: "rule" });
    await run(":mode s2 llm");
    expect(engine.runtime.mode()).toMatchObject({ appraise: "rule", render: "llm" });
  });

  test("picks the S2 tier", async () => {
    const { run, engine } = setup();
    await run(":mode s2 pro");
    expect(engine.runtime.mode()).toMatchObject({ appraise: "llm", render: "llm", s2Tier: "pro" });
  });

  test("says so when nothing changes", async () => {
    const { run, notes } = setup();
    await run(":mode full");
    expect(notes).toEqual([{ text: "Already running [S1:LLM S2:std].", level: undefined }]);
  });

  test("a change made during a turn is queued and the player is told when it takes effect", async () => {
    const { run, engine, notes, applyQueued } = setup({ queueSwitches: true });
    await run(":mode rule");
    expect(notes[0]?.text).toBe("Mode change to [RULE] takes effect after this turn.");
    expect(engine.runtime.mode()).toMatchObject({ appraise: "llm", render: "llm" });
    expect(engine.runtime.pending()).toMatchObject({ appraise: "rule", render: "rule" });
    applyQueued();
    expect(engine.runtime.mode()).toMatchObject({ appraise: "rule", render: "rule" });
    expect(engine.runtime.pending()).toBeNull();
  });

  test("prints a status line", async () => {
    const { run, notes } = setup();
    await run(":mode status");
    expect(notes[0]?.text).toBe("Mode [S1:LLM S2:std] (full) · presets: full, judge-only, narrate-only, rule · S2 tiers: std, pro");
  });

  test("explains the arguments it understands", async () => {
    const { run, notes } = setup();
    await run(":mode sideways");
    expect(notes[0]?.text).toStartWith("Usage: :mode");
  });
});
