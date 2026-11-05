import { describe, expect, test } from "bun:test";
import { Transcript } from "../src/components/Transcript.tsx";
import { createTuiFakeEngine } from "./helpers/fake-engine.ts";
import { flushInkFrame, createInkHarness } from "./helpers/ink-harness.ts";
import { FeedTranscript, TuiTestShell } from "./helpers/tui-shell.tsx";
import type { TranscriptEntry } from "../src/types.ts";

describe("Transcript scrolling", () => {
  test("shows recent dialogue entries in viewport", async () => {
    const entries: TranscriptEntry[] = Array.from({ length: 8 }, (_, i) => ({
      id: `d_${i}`,
      kind: "dialogue",
      text: `Line ${i + 1}`,
      speaker: "mira",
      complete: true,
    }));
    const frame = await flushInkFrame(
      createInkHarness(
        <TuiTestShell engine={createTuiFakeEngine()}>
          <FeedTranscript entries={entries} />
          <Transcript width={60} rows={6} />
        </TuiTestShell>,
      ),
      80,
    );
    expect(frame).toContain("Line 8");
    expect(frame).toContain("mira:");
  });
});
