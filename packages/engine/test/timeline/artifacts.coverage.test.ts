import { describe, expect, test } from "bun:test";
import { MemoryStorage } from "../../src/store/memory.ts";
import { createArtifactStore, removeArtifactPaths } from "../../src/timeline/artifacts.ts";
import { artifactPath, artifactsDir } from "../../src/timeline/paths.ts";
import type { BranchRef } from "../../src/types.ts";

function artifactHarness(opts: {
  chain: BranchRef[];
  branch: string;
  seq?: number;
}) {
  const storage = MemoryStorage();
  let chain = opts.chain;
  let branch = opts.branch;
  let seq = opts.seq ?? 1;
  const store = createArtifactStore(
    storage,
    () => chain,
    () => seq,
    () => branch,
  );
  return {
    storage,
    store,
    setChain(c: BranchRef[]) {
      chain = c;
    },
    setBranch(b: string) {
      branch = b;
    },
    bumpSeq() {
      seq += 1;
    },
  };
}

describe("createArtifactStore", () => {
  test("readText resolves newest branch in chain", async () => {
    const h = artifactHarness({ chain: [{ name: "main" }, { name: "fork", parent: "main", forkAt: "evt_0005" }], branch: "fork" });
    await h.storage.writeAtomic(artifactPath("main", "note.txt"), "old");
    await h.storage.writeAtomic(artifactPath("fork", "note.txt"), "new");
    expect(await h.store.readText("note.txt")).toBe("new");
    expect(await h.store.readText("missing.txt")).toBeUndefined();
  });

  test("readJsonl merges ancestor rows and filters after forkAt seq", async () => {
    const forkAt = "evt_0003";
    const h = artifactHarness({
      chain: [{ name: "main" }, { name: "fork", parent: "main", forkAt }],
      branch: "fork",
    });
    const rel = "npc1/memory.jsonl";
    await h.storage.writeAtomic(
      artifactPath("main", rel),
      [
        JSON.stringify({ id: "a", _seq: 1 }),
        JSON.stringify({ id: "b", _seq: 4 }),
        JSON.stringify({ id: "c", _seq: 2 }),
      ].join("\n") + "\n",
    );
    const rows = await h.store.readJsonl<{ id: string; _seq?: number }>(rel);
    expect(rows.map((r) => r.id)).toEqual(["a", "c"]);
  });

  test("appendJsonl and writeText update index with seq", async () => {
    const h = artifactHarness({ chain: [{ name: "main" }], branch: "main", seq: 7 });
    await h.store.appendJsonl("log.jsonl", { id: "e1" });
    await h.store.writeText("readme.md", "hello");
    const indexPath = `${artifactsDir("main")}/.index.jsonl`;
    const index = (await h.storage.readText(indexPath)) ?? "";
    expect(index).toContain('"seq":7');
    expect(index).toContain("log.jsonl");
    expect(index).toContain("readme.md");
    const rows = await h.store.readJsonl("log.jsonl");
    expect(rows[0]).toMatchObject({ id: "e1", _seq: 7 });
  });

  test("list collects unique relative paths across chain with prefix", async () => {
    const h = artifactHarness({
      chain: [{ name: "main" }, { name: "fork", parent: "main", forkAt: "evt_0001" }],
      branch: "fork",
    });
    await h.storage.writeAtomic(artifactPath("main", "npc1/a.txt"), "a");
    await h.storage.writeAtomic(artifactPath("fork", "npc1/b.txt"), "b");
    await h.storage.writeAtomic(artifactPath("fork", "npc2/c.txt"), "c");
    expect(await h.store.list("npc1/")).toEqual(["npc1/a.txt", "npc1/b.txt"]);
    expect(await h.store.list("")).toContain("npc2/c.txt");
  });
});

describe("removeArtifactPaths", () => {
  test("removes each path under branch artifacts dir", async () => {
    const storage = MemoryStorage();
    await storage.writeAtomic(artifactPath("main", "x/y.txt"), "z");
    await storage.writeAtomic(artifactPath("main", "keep.txt"), "k");
    await removeArtifactPaths(storage, "main", ["x/y.txt"]);
    expect(await storage.exists(artifactPath("main", "x/y.txt"))).toBe(false);
    expect(await storage.exists(artifactPath("main", "keep.txt"))).toBe(true);
  });
});
