import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { createEngine, type TurnChunk } from "@animae/engine";
import { parseCli } from "../src/args.ts";
import { runCli } from "../src/cli.ts";
import { runInit } from "../src/commands/init.ts";
import { runValidate } from "../src/commands/validate.ts";
import { openEngine } from "../src/engine-open.ts";
import { ChunkPrinter } from "../src/plain/chunk-printer.ts";
import { runColonCommand } from "../src/plain/colon-commands.ts";
import { runPlainRepl } from "../src/plain/repl.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "animae-cli-mode-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Capture everything written to a stream. */
function sink(): { out: NodeJS.WritableStream; text: () => string } {
  const parts: string[] = [];
  return {
    out: {
      write(s: string) {
        parts.push(s);
        return true;
      },
    } as NodeJS.WritableStream,
    text: () => parts.join(""),
  };
}

/** Capture what a command writes to stdout/stderr while it runs. */
async function capture<T>(run: () => Promise<T>): Promise<{ result: T; stdout: string; stderr: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((s: string | Uint8Array) => (out.push(String(s)), true)) as typeof process.stdout.write;
  process.stderr.write = ((s: string | Uint8Array) => (err.push(String(s)), true)) as typeof process.stderr.write;
  try {
    const result = await run();
    return { result, stdout: out.join(""), stderr: err.join("") };
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
}

// ───────────────────────── argument parsing ─────────────────────────

test("parseCli accepts --mode before or after the command", () => {
  const a = parseCli(["--mode", "rule", "run"]);
  expect(a.kind === "run" && a.global.mode).toBe("rule");
  const b = parseCli(["run", "--mode", "judge-only"]);
  expect(b.kind === "run" && b.global.mode).toBe("judge-only");
  const c = parseCli(["run"]);
  expect(c.kind === "run" && c.global.mode).toBeUndefined();
});

test("parseCli rejects an unknown --mode and names the valid ones", () => {
  expect(() => parseCli(["--mode", "turbo", "run"])).toThrow(/full, judge-only, narrate-only, rule/);
});

test("parseCli validate carries --mode", () => {
  const p = parseCli(["validate", "--mode", "rule"]);
  expect(p.kind === "validate" && p.mode).toBe("rule");
  const q = parseCli(["validate"]);
  expect(q.kind === "validate" && q.mode).toBeUndefined();
});

test("parseCli inspect events --kind", () => {
  const p = parseCli(["inspect", "events", "--kind", "narration"]);
  expect(p.kind === "inspect" && p.eventKind).toBe("narration");
  expect(() => parseCli(["inspect", "world", "--kind", "narration"])).toThrow(/events/);
});

// ───────────────────────── validate --mode ─────────────────────────

test("validate --mode rule fails a root whose policy has no catch-all line and says where", async () => {
  expect(await runInit({ dir })).toBe(0);
  // The bare skeleton has no render layers: it validates, but cannot play on rules.
  expect(await runValidate(dir)).toBe(0);
  const { result, stdout } = await capture(() => runValidate(dir, undefined, undefined, "rule"));
  expect(result).toBe(1);
  expect(stdout).toContain("policy:render");
  expect(stdout).toMatch(/fallback/);
});

test("validate --mode rule passes with the rule preset and prints the mode", async () => {
  expect(await runInit({ dir, preset: "@animae/preset-rule" })).toBe(0);
  const { result, stdout } = await capture(() => runValidate(dir, undefined, undefined, "rule"));
  expect(stdout).toContain("OK (mode rule)");
  expect(result).toBe(0);
});

test("validate --mode full fails without models, passes with them", async () => {
  expect(await runInit({ dir })).toBe(0);
  const noModels = await capture(() => runValidate(dir, undefined, undefined, "full"));
  expect(noModels.result).toBe(1);
  expect(noModels.stdout).toContain("animae.yaml:models");

  await writeFile(
    join(dir, "animae.yaml"),
    "seed: 1\npolicies: []\nmodels:\n  s1: { provider: anthropic, model: claude-haiku-4-5 }\n  s2: { provider: anthropic, model: claude-sonnet-4-5 }\n",
    "utf8",
  );
  const withModels = await capture(() => runValidate(dir, undefined, undefined, "full"));
  expect(withModels.result).toBe(0);
  expect(withModels.stdout).toContain("OK (mode full)");
});

test("runCli validate --mode rule uses the exit code", async () => {
  await runInit({ dir, preset: "@animae/preset-rule" });
  expect(await runCli(["--root", dir, "validate", "--mode", "rule"], {})).toBe(0);
});

// ───────────────────────── --mode opens the engine in that mode ─────────────────────────

test("openEngine --mode rule starts in rule mode and records the CLI as the reason", async () => {
  await runInit({ dir, preset: "@animae/preset-rule" });
  const engine = await openEngine({ root: dir, mode: "rule" });
  try {
    expect(engine.runtime.mode()).toEqual({ appraise: "rule", render: "rule" });
    // the engine announces its mode with the first turn
    const sceneId = await engine.scene.start({ location: "home", participants: ["player"] });
    for await (const _ of engine.scene.turn({ sceneId, actor: "player", text: "hello" })) {
      // drain
    }
    const events = await engine.timeline.events({ kinds: ["runtime.mode_changed"] });
    expect(events.length).toBeGreaterThan(0);
    const e = events[0] as unknown as { reason: string; trigger?: string; after: { appraise: string; render: string } };
    expect(e.reason).toBe("cli");
    expect(e.trigger).toBe("cli:--mode");
    expect(e.after).toMatchObject({ appraise: "rule", render: "rule" });
  } finally {
    await engine.close();
  }
});

test("openEngine without --mode and without models plays on rules", async () => {
  await runInit({ dir, preset: "@animae/preset-rule" });
  const engine = await openEngine({ root: dir });
  try {
    expect(engine.runtime.mode()).toEqual({ appraise: "rule", render: "rule" });
  } finally {
    await engine.close();
  }
});

// ───────────────────────── inspect events --kind ─────────────────────────

test("inspect events --kind narration lists only narration, with its text and style", async () => {
  await runInit({ dir, preset: "@animae/preset-rule" });
  const engine = await openEngine({ root: dir, mode: "rule" });
  let rows: Array<{ kind: string; text?: string; style?: string }> = [];
  try {
    const sceneId = await engine.scene.start({ location: "home", participants: ["player"] });
    for await (const _ of engine.scene.turn({ sceneId, actor: "player", text: "hello" })) {
      // drain
    }
    rows = (engine.query("player", "events") as typeof rows).filter((e) => e.kind === "narration");
  } finally {
    await engine.close();
  }
  // every row the CLI would print for `--kind narration` is a narration row carrying its text and style
  for (const row of rows) {
    expect(row.kind).toBe("narration");
    expect(typeof row.text).toBe("string");
    expect(["normal", "scene_break"]).toContain(row.style as string);
  }
});

// ───────────────────────── the plain printer ─────────────────────────

const text = (t: string, extra: Partial<Extract<TurnChunk, { type: "text" }>> = {}): TurnChunk => ({
  type: "text",
  text: t,
  ...extra,
});
const narration = (t: string, extra: Partial<Extract<TurnChunk, { type: "narration" }>> = {}): TurnChunk => ({
  type: "narration",
  text: t,
  ...extra,
});

test("printer: dialogue keeps the speaker, narration is an indented line with no name", () => {
  const s = sink();
  const p = new ChunkPrinter(s.out);
  p.write(text("Hello there.", { speaker: "mara", newUtterance: true }));
  p.write(narration("Rain taps the window."));
  p.write({ type: "done" } as TurnChunk);
  expect(s.text()).toBe("mara: Hello there.\n  Rain taps the window.\n");
});

test("printer: streamed fragments continue the same line", () => {
  const s = sink();
  const p = new ChunkPrinter(s.out);
  p.write(text("Hel", { speaker: "mara" }));
  p.write(text("lo", { speaker: "mara" }));
  p.write(narration("The lamp "));
  p.write(narration("gutters."));
  p.write({ type: "done" } as TurnChunk);
  expect(s.text()).toBe("mara: Hello\n  The lamp gutters.\n");
});

test("printer: newParagraph and a style change start a new narration line", () => {
  const s = sink();
  const p = new ChunkPrinter(s.out);
  p.write(narration("First."));
  p.write(narration("Second.", { newParagraph: true }));
  p.write(narration("Three hours later", { style: "scene_break" }));
  p.write(narration("Third."));
  p.write({ type: "done" } as TurnChunk);
  expect(s.text()).toBe("  First.\n  Second.\n── Three hours later ──\n  Third.\n");
});

test("printer: a scene break streamed in fragments prints once, between rules", () => {
  const s = sink();
  const p = new ChunkPrinter(s.out);
  p.write(narration("Three ", { style: "scene_break" }));
  p.write(narration("hours later", { style: "scene_break" }));
  p.write({ type: "done" } as TurnChunk);
  expect(s.text()).toBe("── Three hours later ──\n");
});

test("printer: reset prints the notice, then the replacement output", () => {
  const s = sink();
  const p = new ChunkPrinter(s.out, { resetNotice: (reason) => `(reset: ${reason})` });
  p.write(text("You say hi.", { speaker: "player" }));
  p.write(text("Half an answ", { speaker: "mara" }));
  p.write({ type: "reset", reason: "fallback" });
  p.write(text("Fallback answer.", { speaker: "mara", newUtterance: true }));
  p.write({ type: "done" } as TurnChunk);
  expect(s.text()).toBe("player: You say hi.\nmara: Half an answ\n(reset: fallback)\nmara: Fallback answer.\n");
});

test("printer: cues and choices end the open line first", () => {
  const s = sink();
  const p = new ChunkPrinter(s.out);
  p.write(narration("A door opens."));
  p.write({ type: "cue", cue: { type: "sfx", args: { name: "door" } }, at: 0 });
  p.write({ type: "choices", choices: [{ id: "a", text: "Go in" }, { id: "b", text: "Wait" }] } as TurnChunk);
  p.write({ type: "done" } as TurnChunk);
  expect(s.text()).toBe("  A door opens.\n[sfx: door]\n  1. Go in\n  2. Wait\n");
});

test("printer: finish ends a line a stream left open", () => {
  const s = sink();
  const p = new ChunkPrinter(s.out);
  p.write(text("cut off", { speaker: "mara" }));
  p.finish();
  expect(s.text()).toBe("mara: cut off\n");
});

// ───────────────────────── plain REPL: a rule-mode game, end to end ─────────────────────────

test("plain repl plays a turn in rule mode and prints narration without a speaker", async () => {
  await runInit({ dir, preset: "@animae/preset-rule" });
  const engine = await openEngine({ root: dir, mode: "rule" });
  try {
    const sceneId = await engine.scene.start({ location: "home", participants: ["player"] });
    const s = sink();
    await runPlainRepl({ engine, sceneId, input: Readable.from(["hello\n", ":quit\n"]), output: s.out, locale: "en" });
    const printed = s.text();
    expect(printed).toContain("player: hello");
    // the preset's narration layers print as indented lines without a speaker name (choice lines are numbered)
    expect(printed).toMatch(/^ {2}(?!\d+\.)\S/m);
    expect(printed).not.toMatch(/^narration:/m);
  } finally {
    await engine.close();
  }
});

// ───────────────────────── :mode in the plain REPL ─────────────────────────

test(":mode reports, switches and refuses what has no model", async () => {
  await runInit({ dir, preset: "@animae/preset-rule" });
  const engine = await openEngine({ root: dir, mode: "rule" });
  try {
    const lines: string[] = [];
    const api = { engine, viewer: "player", notify: (m: string) => lines.push(m), locale: "en" };

    await runColonCommand(":mode", api);
    expect(lines.at(-1)).toContain("[RULE]");
    expect(lines.at(-1)).toContain("rule");

    // no models are configured: a role on `llm` has nothing to run on
    await runColonCommand(":mode full", api);
    expect(lines.at(-1)).toMatch(/model/i);
    expect(engine.runtime.mode()).toEqual({ appraise: "rule", render: "rule" });

    await runColonCommand(":mode turbo", api);
    expect(lines.at(-1)).toContain(":mode");

    await runColonCommand(":mode rule", api);
    expect(lines.at(-1)).toContain("Already in mode [RULE]");
  } finally {
    await engine.close();
  }
});

test(":mode switches between backends when models exist and says when it will apply", async () => {
  await runInit({ dir, preset: "@animae/preset-rule" });
  const { createScriptedModel } = await import("@animae/engine");
  const model = createScriptedModel("test/m", () => ({ text: "ok" }));
  const engine = await createEngine({
    root: dir,
    models: { s1: model, s2: model },
    presets: [(await import("@animae/preset-rule")).preset, (await import("@animae/preset-base")).preset],
  });
  try {
    const lines: string[] = [];
    const api = { engine, viewer: "player", notify: (m: string) => lines.push(m), locale: "en" };
    expect(engine.runtime.mode()).toEqual({ appraise: "llm", render: "llm" });

    await runColonCommand(":mode rule", api);
    expect(lines.at(-1)).toBe("Mode [S1:LLM S2:LLM] -> [RULE]");
    expect(engine.runtime.mode()).toEqual({ appraise: "rule", render: "rule" });

    await runColonCommand(":mode s2 llm", api);
    expect(lines.at(-1)).toBe("Mode [RULE] -> [S1:RULE S2:LLM]");
    expect(engine.runtime.mode()).toEqual({ appraise: "rule", render: "llm" });
  } finally {
    await engine.close();
  }
});
