import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { StreamPart } from "../../src/ports.ts";
import {
  replayStreamParts,
  slimStreamPartsForRecord,
} from "../../src/model/recording-stream.ts";
import { withRecording } from "../../src/model/recording.ts";
import { createScriptedModel, streamFromObject } from "../../src/model/scripted.ts";
import type { RecordingStore } from "../../src/contracts.ts";
import { z } from "zod";
import {
  compactRecordingsFile,
  compactRecordingsText,
  compactRecordingLines,
} from "../../src/timeline/recording-compact.ts";
import { createTimeline } from "../../src/timeline/timeline-store.ts";
import { MemoryStorage } from "../../src/store/memory.ts";
import { minimalAuthored, minimalPolicy, fakeCel } from "./fixture.ts";
import { recordingsPath } from "../../src/timeline/paths.ts";

const schema = z.object({ text: z.string() });

function baseReq() {
  return {
    label: "render",
    segments: {
      static: "world rules",
      semiStatic: "relations",
      dynamic: "context",
      user: "hello",
      history: [{ role: "user" as const, content: "prior" }, { role: "assistant" as const, content: "hi" }],
    },
    maxOutputTokens: 256,
    schema,
  };
}

describe("stream recording slim replay", () => {
  test("record stores no partials; replay yields tool-free partial+final", async () => {
    const inner = createScriptedModel("m/m", () => streamFromObject({ text: "abcd" }, 2));
    const store: RecordingStore & { map: Map<string, unknown> } = {
      mode: "record",
      map: new Map(),
      lookup(key) {
        return this.map.get(key);
      },
      async record(key, response) {
        this.map.set(key, response);
      },
    };
    const wrapped = withRecording(inner, store);
    for await (const _ of wrapped.stream(baseReq())) {
      /* drain live stream */
    }
    const stored = store.map.values().next().value as StreamPart[];
    expect(stored.some((p) => p.type === "partial")).toBe(false);
    expect(stored.some((p) => p.type === "final")).toBe(true);

    store.mode = "replay";
    const replay: StreamPart[] = [];
    for await (const p of wrapped.stream(baseReq())) replay.push(p);
    expect(replay.filter((p) => p.type === "partial").length).toBe(1);
    expect(replay.at(-1)?.type).toBe("final");
    expect(replay.at(-1)).toEqual(stored.at(-1));
  });

  test("legacy fixture with partials replays verbatim", async () => {
    const legacy: StreamPart[] = [
      { type: "partial", value: { text: "a" } },
      { type: "partial", value: { text: "ab" } },
      { type: "final", value: { text: "ab" }, usage: { inputTokens: 1, outputTokens: 1 } },
    ];
    const out: StreamPart[] = [];
    for await (const p of replayStreamParts(legacy)) out.push(p);
    expect(out).toEqual(legacy);
  });

  test("long streamed reply recording size is linear not quadratic", async () => {
    const longText = "x".repeat(600);
    const inner = createScriptedModel("m/m", () => streamFromObject({ text: longText }, 1));
    const store: RecordingStore & { map: Map<string, unknown> } = {
      mode: "record",
      map: new Map(),
      lookup(key) {
        return this.map.get(key);
      },
      async record(key, response) {
        this.map.set(key, response);
      },
    };
    const wrapped = withRecording(inner, store);
    for await (const _ of wrapped.stream(baseReq())) {
      /* drain */
    }
    const stored = store.map.values().next().value as StreamPart[];
    const bytes = JSON.stringify(stored).length;
    expect(bytes).toBeLessThan(longText.length * 3);
    expect(slimStreamPartsForRecord(stored).length).toBe(stored.length);
  });
});

describe("recordings compaction and timeline store", () => {
  test("compact drops duplicate keys and partials with last-wins", () => {
    const key = "abc";
    const lines = [
      { key, response: [{ type: "partial", value: { text: "a" } }, { type: "final", value: { text: "a" } }] },
      { key, response: { ok: 1 } },
      { key, response: { ok: 1 } },
    ];
    const { lines: out, stats } = compactRecordingLines(lines as never);
    expect(out.length).toBe(1);
    expect(out[0]!.response).toEqual({ ok: 1 });
    expect(stats.droppedDuplicates).toBe(2);
    expect(stats.droppedPartials).toBeGreaterThan(0);
  });

  test("compactRecordingsFile is atomic and idempotent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rec-compact-"));
    const file = join(dir, "recordings.jsonl");
    const key = "k1";
    const blob = [
      { key, response: [{ type: "partial", value: { t: 1 } }, { type: "final", value: { t: 1 } }] },
      { key, response: [{ type: "partial", value: { t: 2 } }, { type: "final", value: { t: 2 } }] },
    ]
      .map((l) => JSON.stringify(l))
      .join("\n");
    await writeFile(file, `${blob}\n`, "utf8");
    const before = (await readFile(file, "utf8")).length;
    const s1 = await compactRecordingsFile(file);
    expect(s1.before).toBe(before);
    expect(s1.after).toBeLessThan(before);
    const mid = await readFile(file, "utf8");
    const s2 = await compactRecordingsFile(file);
    expect(s2.before).toBe(s2.after);
    expect(await readFile(file, "utf8")).toBe(mid);
    await rm(dir, { recursive: true });
  });

  test("timeline record skips identical duplicate appends", async () => {
    const storage = MemoryStorage();
    const tl = createTimeline({
      storage,
      authored: () => minimalAuthored(),
      policy: () => minimalPolicy(),
      cel: fakeCel,
      seed: 1,
      sessionId: "s",
      modelMode: "record",
    });
    await tl.open();
    await tl.recordings.record("key1", { ok: true });
    await tl.recordings.record("key1", { ok: true });
    const text = (await storage.readText(recordingsPath("main"))) ?? "";
    expect(text.trim().split("\n").length).toBe(1);
    await tl.close();
  });

  test("replay mode open does not rewrite recordings file", async () => {
    const storage = MemoryStorage();
    const path = recordingsPath("main");
    const noisy = `${JSON.stringify({ key: "a", response: { x: 1 } })}\n${JSON.stringify({ key: "a", response: { x: 1 } })}\n`;
    await storage.writeAtomic(path, noisy);
    const tl = createTimeline({
      storage,
      authored: () => minimalAuthored(),
      policy: () => minimalPolicy(),
      cel: fakeCel,
      seed: 1,
      sessionId: "s",
      modelMode: "replay",
    });
    await tl.open();
    expect(await storage.readText(path)).toBe(noisy);
    await tl.close();
  });

  test("compactRecordingsText preserves lookup order", () => {
    const text = [
      JSON.stringify({ key: "a", response: 1 }),
      JSON.stringify({ key: "b", response: 2 }),
      JSON.stringify({ key: "a", response: 3 }),
    ].join("\n");
    const { text: out } = compactRecordingsText(`${text}\n`);
    const lines = out.trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.map((l: { key: string }) => l.key)).toEqual(["b", "a"]);
    expect(lines[1].response).toBe(3);
  });
});
