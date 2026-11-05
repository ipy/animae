import { dirname } from "node:path";
import { describe, expect, test } from "bun:test";
import type { TurnChunk } from "@animae/engine";
import { Box } from "ink";
import { Transcript, NARRATION_INDENT, sceneBreakRule } from "../src/components/Transcript.tsx";
import type { TranscriptEntry } from "../src/types.ts";
import { createTuiFakeEngine } from "./helpers/fake-engine.ts";
import { createInkHarness, waitMs } from "./helpers/ink-harness.ts";
import { After, FeedTranscript, RunTurn, TuiTestShell } from "./helpers/tui-shell.tsx";

const WIDTH = 60;
const WRAP = WIDTH - 4;

function entry(id: string, patch: Partial<TranscriptEntry>): TranscriptEntry {
  return { id, kind: "narration", text: "", complete: true, ...patch };
}

/** Renders the transcript for `settleMs` and returns the last frame. */
async function frameOf(
  node: React.ReactNode,
  engine = createTuiFakeEngine(),
  opts: { settleMs?: number; theme?: Parameters<typeof TuiTestShell>[0]["theme"] } = {},
): Promise<string[]> {
  const harness = createInkHarness(
    <TuiTestShell engine={engine} theme={opts.theme ?? { typewriter: { enabled: false, charsPerSecond: 60 } }}>
      <Box width={WIDTH} height={24} flexDirection="column">
        {node}
      </Box>
    </TuiTestShell>,
  );
  await waitMs(opts.settleMs ?? 80);
  harness.unmount();
  await waitMs(20);
  return harness
    .getFrame()
    .split("\n")
    .map((l) => l.trimEnd());
}

const transcript = <Transcript width={WIDTH} rows={30} />;

/** Ink only paints colors when its chalk instance believes the terminal supports them: switch that on for `fn`. */
async function withColor<T>(fn: () => Promise<T>): Promise<T> {
  const inkEntry = Bun.resolveSync("ink", import.meta.dir);
  const chalkEntry = Bun.resolveSync("chalk", dirname(inkEntry));
  const chalk = (await import(chalkEntry)).default as { level: number };
  const saved = chalk.level;
  chalk.level = 1;
  try {
    return await fn();
  } finally {
    chalk.level = saved;
  }
}

/** The raw frame (with escape codes) of a narration paragraph under `theme`. */
async function rawNarration(theme: Parameters<typeof TuiTestShell>[0]["theme"]): Promise<string> {
  return withColor(async () => {
    const harness = createInkHarness(
      <TuiTestShell engine={createTuiFakeEngine()} theme={theme}>
        <Box width={WIDTH} height={10} flexDirection="column">
          <FeedTranscript entries={[entry("n1", { text: "Tinted." })]} />
          {transcript}
        </Box>
      </TuiTestShell>,
    );
    await waitMs(80);
    harness.unmount();
    await waitMs(20);
    return harness.getRawFrame();
  });
}

describe("narration in the transcript", () => {
  test("a normal paragraph is an indented line with no speaker label", async () => {
    const frame = await frameOf(
      <>
        <FeedTranscript
          entries={[
            entry("d1", { kind: "dialogue", speaker: "mira", text: "Hello." }),
            entry("n1", { text: "Rain falls on the old roof.", style: "normal" }),
          ]}
        />
        {transcript}
      </>,
    );
    const line = frame.find((l) => l.includes("Rain falls"));
    expect(line).toBe(`${" ".repeat(NARRATION_INDENT)}Rain falls on the old roof.`);
    expect(frame.some((l) => l.startsWith("mira"))).toBe(true);
    // no "name:" label is printed for the narrator
    expect(frame.filter((l) => l.includes(":")).every((l) => !l.includes("Rain"))).toBe(true);
  });

  test("consecutive paragraphs are separated by a blank line", async () => {
    const frame = await frameOf(
      <>
        <FeedTranscript
          entries={[entry("n1", { text: "First paragraph." }), entry("n2", { text: "Second paragraph." })]}
        />
        {transcript}
      </>,
    );
    const first = frame.findIndex((l) => l.includes("First paragraph."));
    const second = frame.findIndex((l) => l.includes("Second paragraph."));
    expect(first).toBeGreaterThanOrEqual(0);
    expect(frame.slice(first + 1, second)).toEqual([""]);
  });

  test("a long paragraph wraps inside the indent", async () => {
    const text = "word ".repeat(40).trim();
    const frame = await frameOf(
      <>
        <FeedTranscript entries={[entry("n1", { text })]} />
        {transcript}
      </>,
    );
    const lines = frame.filter((l) => l.includes("word"));
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) {
      expect(l.startsWith(" ".repeat(NARRATION_INDENT))).toBe(true);
      expect(l.length).toBeLessThanOrEqual(WRAP);
    }
    // the text wraps by width, so compare without the whitespace that falls on a line break
    expect(lines.map((l) => l.trim()).join("").replace(/\s/g, "")).toBe(text.replace(/\s/g, ""));
  });

  test("a scene break is a divider, set off by a blank line, followed by its text", async () => {
    const frame = await frameOf(
      <>
        <FeedTranscript
          entries={[
            entry("d1", { kind: "dialogue", speaker: "mira", text: "Good night." }),
            entry("n1", { text: "Three days later.", style: "scene_break" }),
            entry("d2", { kind: "dialogue", speaker: "mira", text: "You are back." }),
          ]}
        />
        {transcript}
      </>,
    );
    const rule = frame.findIndex((l) => l === sceneBreakRule(WRAP));
    expect(rule).toBeGreaterThan(0);
    expect(frame[rule - 1]).toBe("");
    expect(frame[rule + 1]).toBe(`${" ".repeat(NARRATION_INDENT)}Three days later.`);
    expect(frame[rule + 2]).toContain("mira");
  });

  test("a scene break without text is just the divider", async () => {
    const frame = await frameOf(
      <>
        <FeedTranscript entries={[entry("d1", { kind: "dialogue", speaker: "mira", text: "Bye." }), entry("n1", { text: "", style: "scene_break" })]} />
        {transcript}
      </>,
    );
    expect(frame.filter((l) => l === sceneBreakRule(WRAP)).length).toBe(1);
  });

  test("the narrator's color comes from the theme", async () => {
    const tinted = await rawNarration({ typewriter: { enabled: false, charsPerSecond: 60 }, colors: { narration: "magenta" } });
    // magenta foreground is SGR 35
    expect(tinted).toMatch(/\x1b\[35m\s*Tinted\./);
  });

  test("the narrator is gray when the theme says nothing", async () => {
    const plain = await rawNarration({ typewriter: { enabled: false, charsPerSecond: 60 } });
    // gray (bright black) foreground is SGR 90
    expect(plain).toMatch(/\x1b\[90m\s*Tinted\./);
  });
});

describe("typewriter and skip", () => {
  const slow = { typewriter: { enabled: true, charsPerSecond: 20 } };
  const text = "The rain keeps falling on the quiet old roof tonight.";

  test("an unfinished paragraph is typed out a few characters at a time", async () => {
    const frame = await frameOf(
      <>
        <FeedTranscript entries={[entry("n1", { text, complete: false })]} />
        {transcript}
      </>,
      createTuiFakeEngine(),
      { settleMs: 220, theme: slow },
    );
    const shown = frame.map((l) => l.trim()).filter(Boolean).join(" ");
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(text.length);
    expect(text.startsWith(shown)).toBe(true);
  });

  test("skip reveals the whole paragraph at once", async () => {
    const frame = await frameOf(
      <>
        <FeedTranscript entries={[entry("n1", { text, complete: false })]} />
        <After delayMs={60} run={({ dispatch }) => dispatch({ type: "skipTypewriter" })} />
        {transcript}
      </>,
      createTuiFakeEngine(),
      { settleMs: 220, theme: slow },
    );
    expect(frame.map((l) => l.trim()).filter(Boolean).join(" ")).toBe(text);
  });

  test("typing applies to a scene break's text, and the divider shows at once", async () => {
    const frame = await frameOf(
      <>
        <FeedTranscript entries={[entry("n1", { text, style: "scene_break", complete: false })]} />
        {transcript}
      </>,
      createTuiFakeEngine(),
      { settleMs: 220, theme: slow },
    );
    expect(frame.some((l) => l === sceneBreakRule(WRAP))).toBe(true);
    const shown = frame.filter((l) => l !== sceneBreakRule(WRAP)).map((l) => l.trim()).filter(Boolean).join(" ");
    expect(shown.length).toBeLessThan(text.length);
  });
});

function engineWithTurn(chunks: TurnChunk[]) {
  return createTuiFakeEngine({
    scene: {
      ...createTuiFakeEngine().scene,
      turn: async function* () {
        for (const chunk of chunks) yield chunk;
      },
    },
  });
}

describe("a turn through the real hook", () => {
  const done: TurnChunk = { type: "done", turnId: "turn_0001", events: [] };

  test("narration and dialogue appear in stream order after the player's line", async () => {
    const frame = await frameOf(
      <>
        <RunTurn text="Hello" />
        {transcript}
      </>,
      engineWithTurn([
        { type: "text", text: "Hello", speaker: "player", newUtterance: true },
        { type: "narration", text: "Rain taps the window.", newParagraph: true },
        { type: "text", text: "Hi there.", speaker: "mira", newUtterance: true },
        done,
      ]),
    );
    const text = frame.join("\n");
    expect(text.indexOf("Hello")).toBeLessThan(text.indexOf("Rain taps the window."));
    expect(text.indexOf("Rain taps the window.")).toBeLessThan(text.indexOf("Hi there."));
    expect(frame.find((l) => l.includes("Rain taps"))?.startsWith("  ")).toBe(true);
  });

  test("a reset replaces what was shown with the fallback output", async () => {
    const frame = await frameOf(
      <>
        <RunTurn text="Hello" />
        {transcript}
      </>,
      engineWithTurn([
        { type: "text", text: "Hello", speaker: "player", newUtterance: true },
        { type: "narration", text: "A voided paragraph.", newParagraph: true },
        { type: "text", text: "Half a sen", speaker: "mira", newUtterance: true },
        { type: "reset", reason: "fallback" },
        { type: "text", text: "Hello back.", speaker: "mira", newUtterance: true },
        done,
      ]),
    );
    const text = frame.join("\n");
    expect(text).toContain("Hello back.");
    expect(text).not.toContain("voided");
    expect(text).not.toContain("Half a sen");
  });
});
