import { describe, expect, test } from "bun:test";
import { createTuiFakeEngineControls, type FakeRuntimeOptions } from "./helpers/fake-engine.ts";
import { KEYS, mountTui } from "./helpers/app-harness.tsx";
import { waitMs } from "./helpers/ink-harness.ts";

const tiers = {
  s2Tiers: [
    { id: "std", model: "writer/std", tags: ["cheap"] },
    { id: "pro", model: "writer/pro", tags: ["strong"] },
  ],
  s2Default: "std",
};

function app(runtime: FakeRuntimeOptions = {}) {
  const controls = createTuiFakeEngineControls({}, { models: tiers, ...runtime });
  return { ...controls, tui: mountTui({ engine: controls.engine }) };
}

const footerOf = (frame: string[]) => frame.filter((l) => l.includes("turns:")).join(" ");

describe("footer mode indicator", () => {
  test("shows the backend of each role and the S2 tier", async () => {
    const { tui } = app();
    const frame = await tui.finish();
    expect(footerOf(frame)).toContain("[S1:LLM S2:std]");
  });

  test("shows [RULE] when no model serves either role", async () => {
    const { tui } = app({ mode: { appraise: "rule", render: "rule" }, models: { s1Llm: false, s2Tiers: [], s2Default: undefined } });
    expect(footerOf(await tui.finish())).toContain("[RULE]");
  });

  test("shows the mixed modes", async () => {
    const judge = app({ mode: { appraise: "llm", render: "rule" } });
    expect(footerOf(await judge.tui.finish())).toContain("[S1:LLM S2:RULE]");
    const narrate = app({ mode: { appraise: "rule", render: "llm" } });
    expect(footerOf(await narrate.tui.finish())).toContain("[S1:RULE S2:std]");
  });

  test("keeps the indicator whole on a narrow terminal and trims the hints instead", async () => {
    const controls = createTuiFakeEngineControls({}, { models: tiers });
    const tui = mountTui({ engine: controls.engine }, { columns: 80, rows: 30 });
    const frame = await tui.finish();
    expect(footerOf(frame)).toContain("[S1:LLM S2:std]");
    expect(frame.join("\n")).toContain("…");
  });

  test("marks a turn that was served from a higher tier than the mode selects", async () => {
    const { tui, emit } = app();
    await waitMs(60);
    emit("route.decided", {
      appraise: { backend: "llm", slot: "s1", model: "judge/small" },
      render: { backend: "llm", slot: "s2", tier: "pro", model: "writer/pro" },
      triggers: ["anchor"],
      budget: { s1Calls: 1, s2CallsByTier: { pro: 1 } },
    } as never);
    expect(footerOf(await tui.finish())).toContain("[S1:LLM S2:std] ↑pro");
  });

  test("shows a queued change as a pending arrow until the turn boundary applies it", async () => {
    const { tui } = app({ queueSwitches: true });
    await waitMs(60);
    await tui.type(":mode rule");
    await tui.press(KEYS.enter);
    const queued = footerOf(await tui.finish(20));
    expect(queued).toContain("[S1:LLM S2:std] → [RULE]");

    const next = app({ queueSwitches: true });
    await waitMs(60);
    await next.tui.type(":mode rule");
    await next.tui.press(KEYS.enter);
    next.applyQueued();
    const applied = footerOf(await next.tui.finish());
    expect(applied).toContain("[RULE]");
    expect(applied).not.toContain("→");
  });
});

describe("mode panel (F6)", () => {
  test("lists the presets, marks the current one, and shows the S2 tiers", async () => {
    const { tui } = app();
    await waitMs(60);
    await tui.press(KEYS.f6);
    const text = (await tui.finish()).join("\n");
    expect(text).toContain("Runtime mode (F6)");
    expect(text).toContain("Now: [S1:LLM S2:std]");
    expect(text).toMatch(/full — models serve S1 and S2 \(current\)/);
    expect(text).toContain("judge-only");
    expect(text).toContain("narrate-only");
    expect(text).toContain("rule — no model calls");
    expect(text).toMatch(/std\s+writer\/std \[cheap\] \(current\)/);
    expect(text).toMatch(/pro\s+writer\/pro \[strong\]/);
  });

  test("Enter on a preset switches the engine and the transcript says so", async () => {
    const { tui, engine } = app();
    await waitMs(60);
    await tui.press(KEYS.f6, KEYS.down, KEYS.down, KEYS.down, KEYS.enter);
    expect(engine.runtime.mode()).toMatchObject({ appraise: "rule", render: "rule" });
    await tui.press(KEYS.escape);
    const frame = await tui.finish();
    expect(frame.join("\n")).toContain("Mode: [S1:LLM S2:std] → [RULE]");
    expect(footerOf(frame)).toContain("[RULE]");
  });

  test("Enter on a tier picks it for live renders", async () => {
    const { tui, engine } = app();
    await waitMs(60);
    // rows: 4 presets, then std, pro
    await tui.press(KEYS.f6, KEYS.down, KEYS.down, KEYS.down, KEYS.down, KEYS.down, KEYS.down, KEYS.enter);
    expect(engine.runtime.mode()).toMatchObject({ appraise: "llm", render: "llm", s2Tier: "pro" });
    await tui.press(KEYS.escape);
    expect(footerOf(await tui.finish())).toContain("[S1:LLM S2:pro]");
  });

  test("a preset that needs a missing model cannot be picked", async () => {
    const { tui, engine } = app({
      mode: { appraise: "rule", render: "rule" },
      models: { s1Llm: false, s2Tiers: [], s2Default: undefined },
    });
    await waitMs(60);
    await tui.press(KEYS.f6, KEYS.enter); // the cursor starts on `full`, which has no model behind it
    expect(engine.runtime.mode()).toMatchObject({ appraise: "rule", render: "rule" });
    expect((await tui.finish()).join("\n")).toContain("no model configured");
  });

  test("a change made while a turn runs says when it takes effect", async () => {
    const { tui, engine } = app({ queueSwitches: true });
    await waitMs(60);
    await tui.press(KEYS.f6, KEYS.down, KEYS.down, KEYS.down, KEYS.enter);
    expect(engine.runtime.pending()).toMatchObject({ appraise: "rule", render: "rule" });
    const text = (await tui.finish()).join("\n");
    expect(text).toContain("The change takes effect after this turn.");
    expect(text).toContain("→ [RULE]");
  });
});

describe("runtime events in the transcript", () => {
  test("a mode change from elsewhere (budget degrade) is announced with its reason", async () => {
    const { tui, emit } = app();
    await waitMs(60);
    emit("runtime.mode_changed", {
      before: { appraise: "llm", render: "llm" },
      after: { appraise: "llm", render: "rule" },
      reason: "budget",
    } as never);
    expect((await tui.finish()).join("\n")).toContain("Mode: [S1:LLM S2:std] → [S1:LLM S2:RULE] (token budget)");
  });

  test("the mode a timeline starts under is not announced as a change", async () => {
    const { tui, emit } = app();
    await waitMs(60);
    emit("runtime.mode_changed", { before: null, after: { appraise: "llm", render: "llm" }, reason: "config" } as never);
    expect((await tui.finish()).join("\n")).not.toContain("Mode:");
  });

  test("a model failure that the rule backend covered is shown as a warning", async () => {
    const { tui, emit } = app();
    await waitMs(60);
    emit("runtime.fallback_used", {
      phase: "render",
      from: "llm",
      to: "rule",
      error: { code: "MODEL_TIMEOUT", message: "provider timed out" },
    } as never);
    expect((await tui.finish()).join("\n")).toContain("⚠ render fell back to the rule backend: provider timed out");
  });
});
