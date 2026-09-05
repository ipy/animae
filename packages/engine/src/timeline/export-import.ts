import { sha256Hex } from "../store/util.ts";
import type { BranchRef } from "../types.ts";
import { AnimaeError } from "../types.ts";
import type { TimelineDeps } from "./deps.ts";
import { mergeChainEvents, readEventsFile, ensureBranchHeader } from "./event-log.ts";
import { EXPORTS_DIR, branchDir, eventsPath } from "./paths.ts";
import { parseJsonlLines } from "../store/util.ts";
import { rebuildChainFromHeaders } from "./import-helpers.ts";

const ENGINE_VERSION = "1.0.0";

export async function exportBranchToFile(
  deps: TimelineDeps,
  branchName: string,
  o?: { recordings?: boolean; file?: string },
): Promise<string> {
  const authored = deps.authored();
  const chain = await rebuildChainFromHeaders(deps, branchName);
  const timestamp = (deps.now?.() ?? new Date()).toISOString().replace(/[:.]/g, "-");
  const outPath = o?.file ?? `${EXPORTS_DIR}/${branchName}-${timestamp}.asave.jsonl`;
  await deps.storage.mkdir(EXPORTS_DIR);
  const hashes: Record<string, string> = {};
  const lines: string[] = [];

  const authoredPaths = Object.keys(authored.files);
  for (const p of authoredPaths) {
    const content = (await deps.storage.readText(p)) ?? "";
    hashes[p] = sha256Hex(content);
    lines.push(JSON.stringify({ path: p, content }));
  }

  for (const br of chain) {
    const evText = (await deps.storage.readText(eventsPath(br.name))) ?? "";
    const evPath = eventsPath(br.name);
    hashes[evPath] = sha256Hex(evText);
    lines.push(JSON.stringify({ path: evPath, content: evText }));
    const artFiles = await deps.storage.listFiles(`${branchDir(br.name)}/artifacts`);
    for (const f of artFiles) {
      const content = (await deps.storage.readText(f)) ?? "";
      hashes[f] = sha256Hex(content);
      lines.push(JSON.stringify({ path: f, content }));
    }
    if (o?.recordings) {
      const rec = `${branchDir(br.name)}/recordings.jsonl`;
      const content = (await deps.storage.readText(rec)) ?? "";
      if (content) {
        hashes[rec] = sha256Hex(content);
        lines.push(JSON.stringify({ path: rec, content }));
      }
    }
  }

  const manifest = {
    engine: ENGINE_VERSION,
    preset: deps.presetId,
    branch: branchName,
    chain: chain.map((c) => c.name),
    hashes,
  };
  const body = `${JSON.stringify(manifest)}\n${lines.map((l) => l).join("\n")}\n`;
  await deps.storage.writeAtomic(outPath, body);
  return outPath;
}

export async function importBranchFromFile(
  deps: TimelineDeps,
  file: string,
): Promise<BranchRef & { warnings?: { code: string; message: string; file?: string }[] }> {
  const text = (await deps.storage.readText(file)) ?? "";
  const rawLines = text.split("\n").filter((l) => l.trim());
  if (rawLines.length === 0) throw new AnimaeError("IMPORT_INVALID", "Empty import file");
  const manifest = JSON.parse(rawLines[0]!) as {
    engine: string;
    preset?: string;
    branch: string;
    chain: string[];
    hashes: Record<string, string>;
  };
  const entries: { path: string; content: string }[] = [];
  for (let i = 1; i < rawLines.length; i++) {
    entries.push(JSON.parse(rawLines[i]!) as { path: string; content: string });
  }
  for (const [path, expected] of Object.entries(manifest.hashes)) {
    const entry = entries.find((e) => e.path === path);
    const hash = sha256Hex(entry?.content ?? "");
    if (hash !== expected) throw new AnimaeError("IMPORT_HASH_MISMATCH", `Hash mismatch for ${path}`);
  }

  const local = deps.authored();
  const warnings: { code: string; message: string; file?: string }[] = [];
  for (const [path, expected] of Object.entries(manifest.hashes)) {
    if (!path.startsWith("world/") && !path.startsWith("characters/") && !path.startsWith("templates/") && !path.startsWith("policies/") && path !== "animae.yaml") continue;
    const localHash = local.files[path];
    if (localHash && localHash !== expected) {
      warnings.push({ code: "authored_mismatch", message: `Import authored hash differs for ${path}`, file: path });
    }
  }

  const digest = sha256Hex(text).slice(0, 12);
  const existing = (await deps.storage.list("timelines"))
    .map((d) => (d.endsWith("/") ? d.slice(0, -1) : d))
    .filter((n) => n !== "timelines" && !n.includes("/"));
  let newBranch = `import_${digest}`;
  for (let n = 2; existing.includes(newBranch); n++) newBranch = `import_${digest}_${n}`;
  await ensureBranchHeader(deps.storage, newBranch);
  const flatEvents: string[] = [];
  for (const br of manifest.chain) {
    const entry = entries.find((e) => e.path === eventsPath(br));
    if (!entry) continue;
    const parsed = parseJsonlLines(entry.content);
    for (let i = 0; i < parsed.length; i++) {
      const line = parsed[i];
      if (i === 0 && (line as { kind?: string }).kind === "branch.header") continue;
      flatEvents.push(JSON.stringify(line));
    }
  }
  const header = { kind: "branch.header", branch: newBranch };
  await deps.storage.writeAtomic(eventsPath(newBranch), `${JSON.stringify(header)}\n${flatEvents.join("\n")}\n`);

  for (const entry of entries) {
    if (entry.path.includes("/artifacts/") || entry.path.includes("/entities/")) {
      await deps.storage.writeAtomic(entry.path.replace(/^timelines\/[^/]+/, `timelines/${newBranch}`), entry.content);
    }
  }

  return { name: newBranch, warnings };
}
