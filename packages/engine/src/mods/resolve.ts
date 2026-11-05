import { AnimaeError } from "../types.ts";
import type { ModBundle, ModManifest, ModSelection, ResolvedMod } from "../mod.ts";
import type { StoragePort } from "../ports.ts";
import { ModManifestSchema } from "./manifest.ts";
import { parseYaml, sha256Hex, stableStringify } from "../store/util.ts";
import type { ConfigIssue } from "../authored/errors.ts";
import { zodIssues } from "../authored/errors.ts";

export interface ModResolveResult {
  ordered: ResolvedMod[];
  layers: { modId: string; prefix: string }[];
  bundles: ModBundle[];
  warnings: string[];
}

function modContentHash(files: Record<string, string>): string {
  const keys = Object.keys(files).sort();
  return sha256Hex(keys.map((k) => `${k}\0${files[k]}`).join("\n"));
}

function enabledIds(configMods: string[], selection?: ModSelection): string[] {
  if (selection === undefined) return [...configMods];
  if (Array.isArray(selection) && selection.length && typeof selection[0] === "string") {
    return selection as string[];
  }
  const list = selection as { id: string; enabled: boolean }[];
  return list.filter((m) => m.enabled).map((m) => m.id);
}

function topoSort(ids: string[], manifests: Map<string, ModManifest>, enableOrder: string[]): string[] {
  const idSet = new Set(ids);
  const edges = new Map<string, Set<string>>();
  for (const id of ids) {
    const m = manifests.get(id)!;
    edges.set(id, new Set());
    for (const req of m.requires ?? []) {
      if (idSet.has(req)) edges.get(id)!.add(req);
    }
    for (const after of m.loadAfter ?? []) {
      if (idSet.has(after)) edges.get(id)!.add(after);
    }
  }
  const sorted: string[] = [];
  const temp = new Set<string>();
  const perm = new Set<string>();

  function visit(n: string): void {
    if (perm.has(n)) return;
    if (temp.has(n)) throw new AnimaeError("MOD_CONFIG", `mod dependency cycle involving "${n}"`);
    temp.add(n);
    for (const dep of edges.get(n) ?? []) visit(dep);
    temp.delete(n);
    perm.add(n);
    sorted.push(n);
  }

  const orderIndex = new Map(enableOrder.map((id, i) => [id, i]));
  const nodes = [...ids].sort((a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0));
  for (const n of nodes) visit(n);
  return sorted;
}

export async function loadModManifestFromDir(storage: StoragePort, modId: string): Promise<ModManifest | undefined> {
  const text = await storage.readText(`mods/${modId}/mod.yaml`);
  if (text === undefined) return undefined;
  const r = ModManifestSchema.safeParse(parseYaml(text));
  if (!r.success) {
    throw new AnimaeError("MOD_CONFIG", `mods/${modId}/mod.yaml: invalid manifest`, {
      issues: zodIssues(`mods/${modId}/mod.yaml`, r.error),
    });
  }
  if (r.data.id !== modId) {
    throw new AnimaeError("MOD_CONFIG", `mods/${modId}/mod.yaml: id "${r.data.id}" must match directory "${modId}"`);
  }
  return r.data;
}

export async function resolveMods(
  storage: StoragePort,
  configMods: string[],
  opts?: { selection?: ModSelection; bundles?: ModBundle[]; engineVersion?: string },
): Promise<ModResolveResult> {
  const warnings: string[] = [];
  const enabled = enabledIds(configMods, opts?.selection);
  const bundleMap = new Map<string, ModBundle>();
  for (const b of opts?.bundles ?? []) bundleMap.set(b.manifest.id, b);

  const manifests = new Map<string, ModManifest>();
  const filesByMod = new Map<string, Record<string, string>>();

  for (const id of enabled) {
    const bundle = bundleMap.get(id);
    if (bundle) {
      manifests.set(id, bundle.manifest);
      if (Object.keys(bundle.files).length > 0) {
        filesByMod.set(id, bundle.files);
        continue;
      }
    }
    const fsManifest = bundle ? undefined : await loadModManifestFromDir(storage, id);
    const manifest = fsManifest ?? bundle?.manifest;
    if (!manifest) {
      throw new AnimaeError("MOD_CONFIG", `mod "${id}" is enabled but not found (no ModBundle and no mods/${id}/mod.yaml)`);
    }
    if (!manifests.has(id)) manifests.set(id, manifest);
    const files: Record<string, string> = {};
    const prefix = `mods/${id}`;
    for (const path of await storage.listFiles(prefix)) {
      const logical = path.startsWith(`${prefix}/`) ? path.slice(prefix.length + 1) : path;
      if (logical === "mod.yaml") continue;
      const t = await storage.readText(path);
      if (t !== undefined) files[logical] = t;
    }
    filesByMod.set(id, files);
  }

  for (const id of enabled) {
    const m = manifests.get(id)!;
    for (const c of m.conflicts ?? []) {
      if (enabled.includes(c)) {
        throw new AnimaeError("MOD_CONFIG", `mod "${id}" conflicts with enabled mod "${c}"`);
      }
    }
    for (const req of m.requires ?? []) {
      const isPreset = req.startsWith("@");
      if (isPreset) continue;
      if (!enabled.includes(req)) {
        throw new AnimaeError("MOD_CONFIG", `mod "${id}" requires "${req}" but it is not enabled`);
      }
    }
    if (m.engine && opts?.engineVersion) {
      if (!engineRangeSatisfied(m.engine, opts.engineVersion)) {
        warnings.push(`mod "${id}": engine ${opts.engineVersion} may not satisfy required ${m.engine}`);
      }
    }
  }

  const ordered = topoSort(enabled, manifests, enabled);

  const orderedResolved: ResolvedMod[] = ordered.map((id) => {
    const m = manifests.get(id)!;
    const files = filesByMod.get(id) ?? {};
    return {
      id,
      name: m.name,
      version: m.version,
      rating: m.rating,
      tags: m.tags ?? [],
      contentHash: modContentHash(files),
      source: bundleMap.has(id) ? ("bundle" as const) : ("filesystem" as const),
    };
  });

  const layers = ordered.map((id) => ({ modId: id, prefix: `mods/${id}` }));
  const bundles = ordered.map((id) => {
    const b = bundleMap.get(id);
    if (b) return b;
    return { manifest: manifests.get(id)!, files: filesByMod.get(id) ?? {} };
  });

  return { ordered: orderedResolved, layers, bundles, warnings };
}

/** Minimal semver range: exact, or ^major.minor.patch */
function engineRangeSatisfied(range: string, version: string): boolean {
  if (range === version) return true;
  const caret = /^\^(\d+)\.(\d+)\.(\d+)/.exec(range.trim());
  if (!caret) return true;
  const v = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!v) return false;
  return v[1] === caret[1];
}

export function modFingerprint(mods: ResolvedMod[]): string {
  return sha256Hex(stableStringify(mods.map((m) => ({ id: m.id, version: m.version, contentHash: m.contentHash }))));
}

export function modDrift(
  recorded: { id: string; version: string; contentHash: string }[] | undefined,
  current: ResolvedMod[],
): { drift: boolean; message?: string } {
  if (!recorded?.length && !current.length) return { drift: false };
  const a = stableStringify(recorded ?? []);
  const b = stableStringify(current.map((m) => ({ id: m.id, version: m.version, contentHash: m.contentHash })));
  if (a === b) return { drift: false };
  return { drift: true, message: `enabled mods differ from timeline record` };
}

export function formatModIssues(issues: ConfigIssue[]): string {
  return issues.map((i) => `${i.file}:${i.path}: ${i.message}`).join("\n");
}
