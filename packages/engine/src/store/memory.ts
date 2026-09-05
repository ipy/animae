import { AnimaeError } from "../types.ts";
import type { StoragePort } from "../ports.ts";
import { assertRelativePath, joinPath } from "./path.ts";

type Node =
  | { kind: "file"; content: string | Uint8Array; mtimeMs: number }
  | { kind: "dir"; mtimeMs: number };

export function MemoryStorage(root = "memory"): StoragePort {
  const files = new Map<string, Node>();
  let lockPid: number | undefined;

  function getFile(path: string): Node | undefined {
    return files.get(assertRelativePath(path));
  }

  function ensureDir(dirPath: string): void {
    if (!dirPath) return;
    const p = assertRelativePath(dirPath);
    if (!p) return;
    const parts = p.split("/");
    let acc = "";
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      if (!files.has(acc)) files.set(acc, { kind: "dir", mtimeMs: Date.now() });
    }
  }

  function parentOf(path: string): string {
    const i = path.lastIndexOf("/");
    return i >= 0 ? path.slice(0, i) : "";
  }

  return {
    root,
    async readText(path) {
      const n = getFile(path);
      if (!n || n.kind !== "file") return undefined;
      return typeof n.content === "string" ? n.content : new TextDecoder().decode(n.content);
    },
    async readBytes(path) {
      const n = getFile(path);
      if (!n || n.kind !== "file") return undefined;
      return typeof n.content === "string" ? new TextEncoder().encode(n.content) : n.content;
    },
    async writeAtomic(path, data) {
      const p = assertRelativePath(path);
      ensureDir(parentOf(p));
      files.set(p, { kind: "file", content: data, mtimeMs: Date.now() });
    },
    async append(path, data, opts) {
      const p = assertRelativePath(path);
      ensureDir(parentOf(p));
      const prev = getFile(p);
      const prevText = prev?.kind === "file" ? (typeof prev.content === "string" ? prev.content : new TextDecoder().decode(prev.content)) : "";
      files.set(p, { kind: "file", content: prevText + data, mtimeMs: Date.now() });
      void opts;
    },
    async exists(path) {
      const n = getFile(path);
      return n !== undefined;
    },
    async list(dir) {
      const d = dir ? assertRelativePath(dir) : "";
      const prefix = d ? `${d}/` : "";
      const names = new Set<string>();
      for (const key of files.keys()) {
        if (!key.startsWith(prefix) && !(d === "" && !key.includes("/"))) continue;
        const rest = d ? key.slice(prefix.length) : key;
        if (!rest) continue;
        const slash = rest.indexOf("/");
        names.add(slash >= 0 ? `${rest.slice(0, slash)}/` : rest);
      }
      return [...names].sort();
    },
    async listFiles(dir) {
      const d = dir ? assertRelativePath(dir) : "";
      const prefix = d ? `${d}/` : "";
      const out: string[] = [];
      for (const [key, node] of files) {
        if (node.kind !== "file") continue;
        if (d === "" || key.startsWith(prefix)) {
          if (d === "" || key !== d) out.push(key);
        }
      }
      return out.sort();
    },
    async mkdir(dir) {
      ensureDir(dir);
    },
    async remove(path, opts) {
      const p = assertRelativePath(path);
      if (opts?.recursive) {
        for (const key of [...files.keys()]) {
          if (key === p || key.startsWith(`${p}/`)) files.delete(key);
        }
        return;
      }
      files.delete(p);
    },
    async stat(path) {
      const n = getFile(path);
      if (!n) return undefined;
      if (n.kind === "dir") return { size: 0, mtimeMs: n.mtimeMs, isDir: true };
      const size = typeof n.content === "string" ? new TextEncoder().encode(n.content).length : n.content.length;
      return { size, mtimeMs: n.mtimeMs, isDir: false };
    },
    async acquireLock() {
      const pid = process.pid;
      if (lockPid !== undefined && lockPid !== pid && isPidAlive(lockPid)) {
        throw new AnimaeError("LOCKED", `Storage locked by pid ${lockPid}`);
      }
      lockPid = pid;
      await this.writeAtomic(".animae.lock", String(pid));
    },
    async releaseLock() {
      lockPid = undefined;
      await this.remove(".animae.lock");
    },
  };
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export { joinPath };
