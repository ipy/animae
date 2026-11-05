import { describe, expect, test } from "bun:test";
import { Transcript, sceneBreakRule, NARRATION_INDENT } from "../src/components/Transcript.tsx";
import { createTuiFakeEngine } from "./helpers/fake-engine.ts";
import { createInkHarness, flushInkFrame } from "./helpers/ink-harness.ts";
import { FeedTranscript, TuiTestShell } from "./helpers/tui-shell.tsx";
import type { TranscriptEntry } from "../src/types.ts";

describe("Transcript narration blocks", () => {
  test("scene break draws divider rule", () => {
    expect(sceneBreakRule(10)).toBe("──────────");
    expect(NARRATION_INDENT).toBe(2);
  });

  test("renders narration and scene_break entries", async () => {
    const entries: TranscriptEntry[] = [
      { id: "n1", kind: "narration", text: "Wind howls.", complete: true },
      {
        id: "n2",
        kind: "narration",
        text: "Later.",
        style: "scene_break",
        complete: true,
      },
    ];
    const frame = await flushInkFrame(
      createInkHarness(
        <TuiTestShell engine={createTuiFakeEngine()}>
          <FeedTranscript entries={entries} />
          <Transcript width={50} rows={8} />
        </TuiTestShell>,
      ),
      100,
    );
    expect(frame).toContain("Wind howls");
    expect(frame).toContain("Later");
  });
});
