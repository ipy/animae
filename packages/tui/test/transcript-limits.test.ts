import { test, expect } from "bun:test";
import {
  MAX_TRANSCRIPT_ENTRIES,
  trimTranscript,
  transcriptEntryWindow,
} from "../src/utils/transcript-limits.ts";

test("trimTranscript caps length", () => {
  const long = Array.from({ length: MAX_TRANSCRIPT_ENTRIES + 50 }, (_, i) => i);
  const trimmed = trimTranscript(long);
  expect(trimmed.length).toBe(MAX_TRANSCRIPT_ENTRIES);
  expect(trimmed[0]).toBe(50);
});

test("transcriptEntryWindow scales with terminal height", () => {
  expect(transcriptEntryWindow(24)).toBeGreaterThanOrEqual(12);
  expect(transcriptEntryWindow(50)).toBeGreaterThan(transcriptEntryWindow(24));
});
