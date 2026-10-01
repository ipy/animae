// @ts-nocheck
import { expect, test } from "bun:test";
import {
  filterLlmEntries,
  entriesToJsonl,
  promptText,
  formatTokens,
  mergeLlmEntriesBySeq,
  fetchAllLlmLogEntries,
} from "../ref-client/js/llm-log-lib.js";

const sample = [
  { seq: 2, slot: "s1", label: "render", modelId: "m", status: "ok", request: { segments: [{ role: "user", text: "hi" }] } },
  { seq: 1, slot: "s2", label: "appraise", modelId: "m", status: "error", request: { segments: [] } },
];

test("filterLlmEntries by slot and errors", () => {
  const rows = filterLlmEntries(sample, { slot: "s1" });
  expect(rows).toHaveLength(1);
  expect(filterLlmEntries(sample, { errorsOnly: true })).toHaveLength(1);
});

test("entriesToJsonl lines", () => {
  const lines = entriesToJsonl(sample);
  expect(lines.split("\n")).toHaveLength(2);
});

test("promptText joins segments", () => {
  expect(promptText(sample[0])).toContain("[user]");
});

test("formatTokens usage", () => {
  const e = {
    ...sample[0],
    response: { usage: { inputTokens: 1, outputTokens: 2 } },
  };
  expect(formatTokens(e)).toBe("1 / 2");
});

test("mergeLlmEntriesBySeq dedupes by seq", () => {
  const merged = mergeLlmEntriesBySeq(
    [{ seq: 1, label: "a" }],
    [{ seq: 1, label: "b" }, { seq: 2, label: "c" }],
  );
  expect(merged).toHaveLength(2);
  expect(merged.find((e) => e.seq === 1)?.label).toBe("b");
});

test("fetchAllLlmLogEntries paginates until short page", async () => {
  let calls = 0;
  const { entries, newestSeq } = await fetchAllLlmLogEntries(async (since) => {
    calls++;
    if (since == null) {
      return {
        enabled: true,
        newestSeq: 100,
        entries: Array.from({ length: 50 }, (_, i) => ({ seq: i + 1 })),
      };
    }
    return { enabled: true, newestSeq: 100, entries: [{ seq: 51 }] };
  });
  expect(calls).toBe(2);
  expect(entries).toHaveLength(51);
  expect(newestSeq).toBe(100);
});
