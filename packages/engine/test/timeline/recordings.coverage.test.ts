import { describe, expect, test } from "bun:test";
import { MemoryStorage } from "../../src/store/memory.ts";
import { appendJsonl } from "../../src/store/util.ts";
import { lookupRecording, readRecordings } from "../../src/timeline/recordings.ts";
import { recordingsPath } from "../../src/timeline/paths.ts";

describe("readRecordings and lookupRecording", () => {
  test("readRecordings returns empty when file missing", async () => {
    const storage = MemoryStorage();
    expect(await readRecordings(storage, "main")).toEqual([]);
  });

  test("readRecordings parses jsonl lines", async () => {
    const storage = MemoryStorage();
    await appendJsonl(storage, recordingsPath("main"), { key: "a", response: { v: 1 } });
    await appendJsonl(storage, recordingsPath("main"), { key: "b", response: [1, 2] });
    const lines = await readRecordings(storage, "main");
    expect(lines.map((l) => l.key)).toEqual(["a", "b"]);
    expect(lines[1]?.response).toEqual([1, 2]);
  });

  test("lookupRecording walks branch chain last-wins per branch", async () => {
    const storage = MemoryStorage();
    await appendJsonl(storage, recordingsPath("main"), { key: "k", response: "root" });
    await appendJsonl(storage, recordingsPath("fork"), { key: "k", response: "fork" });
    await appendJsonl(storage, recordingsPath("fork"), { key: "other", response: 9 });
    const hit = await lookupRecording(storage, [{ name: "main" }, { name: "fork", parent: "main", forkAt: "evt_0001" }], "k");
    expect(hit).toBe("fork");
    expect(await lookupRecording(storage, [{ name: "main" }], "k")).toBe("root");
    expect(await lookupRecording(storage, [{ name: "main" }], "missing")).toBeUndefined();
  });

  test("lookupRecording prefers later duplicate keys on same branch", async () => {
    const storage = MemoryStorage();
    const path = recordingsPath("main");
    await storage.writeAtomic(
      path,
      `${JSON.stringify({ key: "x", response: 1 })}\n${JSON.stringify({ key: "x", response: 2 })}\n`,
    );
    expect(await lookupRecording(storage, [{ name: "main" }], "x")).toBe(2);
  });
});
