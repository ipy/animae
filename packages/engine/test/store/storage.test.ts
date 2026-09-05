import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FsStorage } from "../../src/store/fs.ts";
import { MemoryStorage } from "../../src/store/memory.ts";
import { readJsonl, repairJsonlText, sha256Hex, stableStringify, parseFrontmatter } from "../../src/store/util.ts";
import { AnimaeError } from "../../src/types.ts";

test("MemoryStorage root-level write", async () => {
  const s = MemoryStorage();
  await s.writeAtomic("animae.yaml", "preset: p\n");
  expect(await s.readText("animae.yaml")).toBe("preset: p\n");
  expect(await s.listFiles("")).toContain("animae.yaml");
});

test("MemoryStorage atomic append and listFiles", async () => {
  const s = MemoryStorage();
  await s.writeAtomic("a/b.txt", "hello");
  expect(await s.readText("a/b.txt")).toBe("hello");
  await s.append("a/b.txt", "!");
  expect(await s.readText("a/b.txt")).toBe("hello!");
  const files = await s.listFiles("a");
  expect(files).toContain("a/b.txt");
});

test("path guard rejects absolute and dot-dot", async () => {
  const s = MemoryStorage();
  await expect(s.readText("/etc/passwd")).rejects.toBeInstanceOf(AnimaeError);
  await expect(s.readText("../secret")).rejects.toBeInstanceOf(AnimaeError);
});

test("readJsonl ignores truncated final line", async () => {
  const s = MemoryStorage();
  await s.writeAtomic("log.jsonl", '{"a":1}\n{"b":2}\n{"bad"\n');
  const rows = await readJsonl(s, "log.jsonl");
  expect(rows).toEqual([{ a: 1 }, { b: 2 }]);
});

test("repairJsonlText drops incomplete last line", () => {
  const { text, dropped } = repairJsonlText('{"a":1}\n{"x":\n');
  expect(dropped).toBe(true);
  expect(text).toBe('{"a":1}\n');
});

test("stableStringify sorts keys", () => {
  expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
});

test("parseFrontmatter", () => {
  const { data, body } = parseFrontmatter("---\ntitle: x\n---\nbody");
  expect(data.title).toBe("x");
  expect(body).toBe("body");
});

test("sha256Hex deterministic", () => {
  expect(sha256Hex("x")).toHaveLength(64);
  expect(sha256Hex("x")).toBe(sha256Hex("x"));
});

test("FsStorage lock acquire and stale steal", async () => {
  const dir = await mkdtemp(join(tmpdir(), "animae-store-"));
  try {
    const a = FsStorage(dir);
    await a.acquireLock();
    await a.releaseLock();
    await a.writeAtomic(".animae.lock", String(process.pid));
    await a.acquireLock();
    await a.releaseLock();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("FsStorage rejects path escape", async () => {
  const dir = await mkdtemp(join(tmpdir(), "animae-store-"));
  try {
    const s = FsStorage(dir);
    await expect(s.readText("../../etc/passwd")).rejects.toBeInstanceOf(AnimaeError);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
