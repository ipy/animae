import type { StoragePort } from "../ports.ts";
import { appendJsonl, parseJsonlLines, readJsonl } from "../store/util.ts";
import type { ArtifactStore } from "../contracts.ts";
import type { BranchRef } from "../types.ts";
import { parseEventSeq } from "./ids.ts";
import { artifactIndexPath, artifactPath, artifactsDir } from "./paths.ts";

export function createArtifactStore(
  storage: StoragePort,
  getChain: () => BranchRef[],
  getSeq: () => number,
  getBranch: () => string,
): ArtifactStore {
  return {
    async readJsonl<T>(path: string): Promise<T[]> {
      const chain = getChain();
      let merged: T[] = [];
      for (let i = 0; i < chain.length; i++) {
        const br = chain[i]!;
        const full = artifactPath(br.name, path);
        if (!(await storage.exists(full))) continue;
        const text = (await storage.readText(full)) ?? "";
        let lines = parseJsonlLines(text) as T[];
        const child = chain[i + 1];
        if (child?.forkAt) {
          const forkSeq = parseEventSeq(child.forkAt);
          lines = lines.filter((row) => ((row as { _seq?: number })._seq ?? 0) <= forkSeq) as T[];
        }
        merged = lines;
      }
      return merged;
    },
    async appendJsonl(path, obj) {
      const branch = getBranch();
      const seq = getSeq();
      await storage.mkdir(artifactsDir(branch));
      await appendJsonl(storage, artifactPath(branch, path), { ...(obj as object), _seq: seq }, { fsync: true });
      await appendJsonl(storage, artifactIndexPath(branch), { path, seq, op: "write" }, { fsync: true });
    },
    async readText(path) {
      const chain = getChain();
      for (let i = chain.length - 1; i >= 0; i--) {
        const br = chain[i]!;
        const full = artifactPath(br.name, path);
        if (await storage.exists(full)) return storage.readText(full);
      }
      return undefined;
    },
    async writeText(path, text) {
      const branch = getBranch();
      const seq = getSeq();
      await storage.mkdir(artifactsDir(branch));
      await storage.writeAtomic(artifactPath(branch, path), text);
      await appendJsonl(storage, artifactIndexPath(branch), { path, seq, op: "write" }, { fsync: true });
    },
    async list(prefix) {
      const chain = getChain();
      const paths = new Set<string>();
      for (const br of chain) {
        const dir = artifactsDir(br.name);
        const files = await storage.listFiles(dir);
        for (const f of files) {
          const rel = f.slice(dir.length + 1);
          if (rel.startsWith(".index")) continue;
          if (rel.startsWith(prefix)) paths.add(rel);
        }
      }
      return [...paths].sort();
    },
  };
}

export async function removeArtifactPaths(storage: StoragePort, branch: string, paths: string[]): Promise<void> {
  for (const p of paths) {
    await storage.remove(artifactPath(branch, p));
  }
}
