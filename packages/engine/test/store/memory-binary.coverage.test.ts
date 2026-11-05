import { describe, expect, test } from "bun:test";
import { MemoryStorage } from "../../src/store/memory.ts";
import { FsStorage, hashFilePath } from "../../src/store/fs.ts";
import { AnimaeError } from "../../src/types.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("MemoryStorage binary and lock", () => {
  test("readBytes and readText round-trip binary content", async () => {
    const s = MemoryStorage();
    const bytes = new Uint8Array([0, 255, 128]);
    await s.writeAtomic("bin.dat", bytes);
    expect(await s.readBytes("bin.dat")).toEqual(bytes);
    expect(await s.readText("bin.dat")).toBe(new TextDecoder().decode(bytes));
  });

  test("stat reports file size and directory flag", async () => {
    const s = MemoryStorage();
    await s.mkdir("d/sub");
    await s.writeAtomic("d/sub/f.txt", "abc");
    const fileStat = await s.stat("d/sub/f.txt");
    expect(fileStat?.isDir).toBe(false);
    expect(fileStat?.size).toBe(3);
    const dirStat = await s.stat("d/sub");
    expect(dirStat?.isDir).toBe(true);
  });

  test("recursive remove deletes subtree", async () => {
    const s = MemoryStorage();
    await s.writeAtomic("tree/a/x.txt", "1");
    await s.writeAtomic("tree/b/y.txt", "2");
    await s.remove("tree", { recursive: true });
    expect(await s.exists("tree/a/x.txt")).toBe(false);
    expect(await s.listFiles("")).not.toContain("tree/a/x.txt");
  });

  test("acquireLock and releaseLock on same instance", async () => {
    const s = MemoryStorage();
    await s.acquireLock();
    await s.acquireLock();
    await s.releaseLock();
    expect(await s.exists(".animae.lock")).toBe(false);
  });
});

describe("FsStorage helpers", () => {
  test("hashFilePath is stable short hex", () => {
    expect(hashFilePath("a/b")).toHaveLength(8);
    expect(hashFilePath("a/b")).toBe(hashFilePath("a/b"));
  });

  test("list and stat on missing paths", async () => {
    const dir = await mkdtemp(join(tmpdir(), "animae-fs-cov-"));
    try {
      const s = FsStorage(dir);
      expect(await s.list("nope")).toEqual([]);
      expect(await s.listFiles("nope")).toEqual([]);
      expect(await s.stat("nope/file.txt")).toBeUndefined();
      expect(await s.readBytes("nope/file.txt")).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
