import { createHash, randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { AnimaeError } from "../types.ts";
import type { StoragePort } from "../ports.ts";
import { assertRelativePath } from "./path.ts";

export function FsStorage(root: string): StoragePort {
  const absRoot = resolve(root);

  function absPath(rel: string): string {
    const p = assertRelativePath(rel);
    const full = resolve(absRoot, p);
    const relCheck = relative(absRoot, full);
    if (relCheck.startsWith("..") || resolve(full) !== full) {
      throw new AnimaeError("STORAGE_PATH", `Path escapes root: ${rel}`);
    }
    return full;
  }

  async function ensureParent(filePath: string): Promise<void> {
    const dir = dirname(filePath);
    if (dir === "." || dir === absRoot) return;
    await mkdir(dir, { recursive: true });
  }

  return {
    root: absRoot,
    async readText(path) {
      try {
        return await readFile(absPath(path), "utf8");
      } catch (e: unknown) {
        if (isEnoent(e)) return undefined;
        throw e;
      }
    },
    async readBytes(path) {
      try {
        return new Uint8Array(await readFile(absPath(path)));
      } catch (e: unknown) {
        if (isEnoent(e)) return undefined;
        throw e;
      }
    },
    async writeAtomic(path, data) {
      const target = absPath(path);
      await ensureParent(target);
      const tmp = `${target}.tmp-${randomBytes(4).toString("hex")}`;
      const buf = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
      const fh = await open(tmp, "w");
      try {
        await fh.writeFile(buf);
        await fh.sync();
      } finally {
        await fh.close();
      }
      await rename(tmp, target);
    },
    async append(path, data, opts = {}) {
      const target = absPath(path);
      await ensureParent(target);
      const fh = await open(target, "a");
      try {
        await fh.writeFile(data, "utf8");
        if (opts.fsync !== false) await fh.sync();
      } finally {
        await fh.close();
      }
    },
    async exists(path) {
      try {
        await stat(absPath(path));
        return true;
      } catch (e: unknown) {
        if (isEnoent(e)) return false;
        throw e;
      }
    },
    async list(dir) {
      const d = absPath(dir || ".");
      try {
        const entries = await readdir(d, { withFileTypes: true });
        return entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).sort();
      } catch (e: unknown) {
        if (isEnoent(e)) return [];
        throw e;
      }
    },
    async listFiles(dir) {
      const base = absPath(dir || ".");
      const out: string[] = [];
      async function walk(rel: string, full: string): Promise<void> {
        let entries;
        try {
          entries = await readdir(full, { withFileTypes: true });
        } catch (e: unknown) {
          if (isEnoent(e)) return;
          throw e;
        }
        for (const e of entries) {
          const name = e.name;
          const childRel = rel ? `${rel}/${name}` : name;
          const childFull = join(full, name);
          if (e.isDirectory()) await walk(childRel, childFull);
          else out.push(childRel);
        }
      }
      try {
        await walk(dir ? assertRelativePath(dir) : "", base);
      } catch (e: unknown) {
        if (isEnoent(e)) return [];
        throw e;
      }
      return out.sort();
    },
    async mkdir(dir) {
      await mkdir(absPath(dir), { recursive: true });
    },
    async remove(path, opts) {
      await rm(absPath(path), { ...(opts?.recursive ? { recursive: true } : {}), force: true });
    },
    async stat(path) {
      try {
        const s = await stat(absPath(path));
        return { size: s.size, mtimeMs: s.mtimeMs, isDir: s.isDirectory() };
      } catch (e: unknown) {
        if (isEnoent(e)) return undefined;
        throw e;
      }
    },
    async acquireLock() {
      const lockPath = absPath(".animae.lock");
      const myPid = process.pid;
      let existing: string | undefined;
      try {
        existing = await readFile(lockPath, "utf8");
      } catch (e: unknown) {
        if (!isEnoent(e)) throw e;
      }
      if (existing) {
        const pid = Number.parseInt(existing.trim(), 10);
        if (Number.isFinite(pid) && pid !== myPid && isPidAlive(pid)) {
          throw new AnimaeError("LOCKED", `Storage locked by pid ${pid}`);
        }
      }
      await this.writeAtomic(".animae.lock", String(myPid));
    },
    async releaseLock() {
      try {
        await rm(absPath(".animae.lock"), { force: true });
      } catch (e: unknown) {
        if (!isEnoent(e)) throw e;
      }
    },
  };
}

function isEnoent(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "ENOENT";
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function hashFilePath(path: string): string {
  return createHash("sha256").update(path).digest("hex").slice(0, 8);
}
