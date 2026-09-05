import type { StoragePort } from "../ports.ts";
import { AnimaeError } from "../types.ts";
import { appendJsonl, parseJsonlLines, sha256Hex } from "../store/util.ts";

export interface AcardManifest {
  engine: "animae";
  kind: "card";
  id: string;
  hashes: Record<string, string>;
}

export async function exportAcard(storage: StoragePort, charId: string): Promise<string> {
  const prefix = `characters/${charId}/`;
  const paths = (await storage.listFiles(`characters/${charId}`)).filter((p) => p.startsWith(prefix) || p === prefix.slice(0, -1));
  const allPaths = paths.length ? paths : await storage.listFiles(`characters/${charId}`);
  if (!allPaths.some((p) => p.endsWith("card.md"))) {
    throw new AnimaeError("NOT_FOUND", `character "${charId}" has no authored files`);
  }
  const hashes: Record<string, string> = {};
  const lines: { path: string; content: string }[] = [];
  for (const path of allPaths.sort()) {
    const text = await storage.readText(path);
    if (text === undefined) continue;
    hashes[path] = sha256Hex(text);
    lines.push({ path, content: text });
  }
  const outPath = `exports/${charId}.acard.jsonl`;
  await storage.mkdir("exports");
  await storage.writeAtomic(outPath, "");
  const manifest: AcardManifest = { engine: "animae", kind: "card", id: charId, hashes };
  await appendJsonl(storage, outPath, manifest);
  for (const line of lines) await appendJsonl(storage, outPath, line);
  return outPath;
}

export async function importAcard(storage: StoragePort, file: string): Promise<string> {
  const text = await storage.readText(file);
  if (text === undefined) throw new AnimaeError("NOT_FOUND", `acard file not found: ${file}`);
  const rows = parseJsonlLines(text);
  if (!rows.length) throw new AnimaeError("CONFIG_INVALID", `${file}: empty acard`);
  const manifest = rows[0] as AcardManifest;
  if (manifest.engine !== "animae" || manifest.kind !== "card" || !manifest.id) {
    throw new AnimaeError("CONFIG_INVALID", `${file}: invalid manifest`);
  }
  const charId = manifest.id;
  const destPrefix = `characters/${charId}/`;
  if (await storage.exists(destPrefix.slice(0, -1)) || (await storage.listFiles(`characters/${charId}`)).length) {
    throw new AnimaeError("ENTITY_DUPLICATE", `character "${charId}" already exists`);
  }
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] as { path?: string; content?: string };
    if (!row.path || row.content === undefined) {
      throw new AnimaeError("CONFIG_INVALID", `${file}: line ${i + 1}: expected {path, content}`);
    }
    if (!row.path.startsWith(destPrefix)) {
      throw new AnimaeError("CONFIG_INVALID", `${file}: line ${i + 1}: path must be under ${destPrefix}`);
    }
    const expected = manifest.hashes[row.path];
    if (!expected) throw new AnimaeError("CONFIG_INVALID", `${file}: unexpected path ${row.path}`);
    const hash = sha256Hex(row.content);
    if (hash !== expected) {
      throw new AnimaeError("CONFIG_INVALID", `${file}: hash mismatch for ${row.path}`);
    }
    await storage.mkdir(row.path.split("/").slice(0, -1).join("/"));
    await storage.writeAtomic(row.path, row.content);
  }
  return charId;
}
