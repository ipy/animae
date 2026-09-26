import type { StoragePort } from "../ports.ts";
import { mergeMarkdownAppend } from "../prose/for-prompt.ts";
import { parseFrontmatter, stringifyYaml, parseYaml } from "../store/util.ts";
import { applyPatchMerge } from "./patch-merge.ts";
import type { ModProvenanceEntry } from "../mod.ts";

export interface ModStorageLayer {
  modId: string;
  /** prefix under data root, e.g. `mods/my-mod` */
  prefix: string;
}

export interface LayeredStorageOptions {
  base: StoragePort;
  modLayers: ModStorageLayer[];
  /** BCP-47 chain (most preferred first) for `mods/<id>/locales/<locale>/…` overlays (after mod file merge). */
  contentLocaleChain?: readonly string[];
  /** filled on read: logical path -> winning layer */
  provenance?: Map<string, ModProvenanceEntry>;
}

function patchPathFor(logicalPath: string): string {
  if (logicalPath.endsWith(".yaml")) return logicalPath.replace(/\.yaml$/, ".patch.yaml");
  if (logicalPath.endsWith(".md")) return logicalPath.replace(/\.md$/, ".patch.yaml");
  return `${logicalPath}.patch.yaml`;
}

function appendPathFor(logicalPath: string): string | undefined {
  if (logicalPath.endsWith("card.md")) return logicalPath.replace(/card\.md$/, "card.append.md");
  return undefined;
}

function modOverlayPath(prefix: string, logicalPath: string): string {
  return `${prefix}/${logicalPath}`;
}

function isOverlayMetaPath(logicalPath: string): boolean {
  return logicalPath.endsWith(".patch.yaml") || logicalPath.endsWith(".append.md") || logicalPath.endsWith("/mod.yaml") || logicalPath === "mod.yaml";
}

async function readModFile(base: StoragePort, prefix: string, logicalPath: string): Promise<string | undefined> {
  return base.readText(modOverlayPath(prefix, logicalPath));
}

function mergeMarkdownWithPatch(content: string, patchYaml: string): string {
  const { data, body } = parseFrontmatter(content);
  const patchDoc = parseYaml(patchYaml);
  const merged = applyPatchMerge(data, patchDoc) as Record<string, unknown>;
  const fm = stringifyYaml(merged).trimEnd();
  return `---\n${fm}\n---\n${body}`;
}

/**
 * Read-only view: base authored tree with mod overlays applied in order (full file replace, then patch, then card append).
 */
export function createLayeredStorage(opts: LayeredStorageOptions): StoragePort {
  const { base, modLayers, provenance, contentLocaleChain = [] } = opts;

  function setProv(path: string, entry: ModProvenanceEntry): void {
    provenance?.set(path, entry);
  }

  async function allLogicalPaths(): Promise<string[]> {
    const set = new Set<string>();
    for (const path of await base.listFiles("")) {
      if (path.startsWith("mods/")) continue;
      if (!isOverlayMetaPath(path)) set.add(path);
    }
    for (const mod of modLayers) {
      for (const path of await base.listFiles(mod.prefix)) {
        if (!path.startsWith(`${mod.prefix}/`)) continue;
        const logical = path.slice(mod.prefix.length + 1);
        if (!isOverlayMetaPath(logical)) set.add(logical);
      }
    }
    return [...set].sort();
  }

  async function readModLocaleFile(prefix: string, locale: string, logicalPath: string): Promise<string | undefined> {
    return base.readText(`${prefix}/locales/${locale}/${logicalPath}`);
  }

  async function applyModLocaleOverlays(
    prefix: string,
    logicalPath: string,
    content: string | undefined,
  ): Promise<string | undefined> {
    if (content === undefined) return undefined;
    let out = content;
    const appendRel = appendPathFor(logicalPath);
    // Most preferred locale first; the first one that localizes this path wins and later tags only fill gaps.
    for (const locale of contentLocaleChain) {
      const full = await readModLocaleFile(prefix, locale, logicalPath);
      const patchText = await readModLocaleFile(prefix, locale, patchPathFor(logicalPath));
      const append = appendRel ? await readModLocaleFile(prefix, locale, appendRel) : undefined;
      if (full === undefined && patchText === undefined && append === undefined) continue;
      if (full !== undefined) out = full;
      if (patchText !== undefined) {
        if (logicalPath.endsWith(".md")) out = mergeMarkdownWithPatch(out, patchText);
        else if (logicalPath.endsWith(".yaml")) {
          out = stringifyYaml(applyPatchMerge(parseYaml(out), parseYaml(patchText)));
        }
      }
      if (append !== undefined) out = mergeMarkdownAppend(out, append);
      break;
    }
    return out;
  }

  async function resolveLogicalText(logicalPath: string): Promise<string | undefined> {
    if (isOverlayMetaPath(logicalPath)) return undefined;

    let content = await base.readText(logicalPath);
    let layer: ModProvenanceEntry = { layer: "base" };
    const appends: string[] = [];
    let winningModPrefix: string | undefined;

    for (const mod of modLayers) {
      const full = await readModFile(base, mod.prefix, logicalPath);
      if (full !== undefined) {
        content = full;
        layer = { layer: "mod", id: mod.modId };
        winningModPrefix = mod.prefix;
        appends.length = 0;
      }
      const patchRel = patchPathFor(logicalPath);
      const patchText = await readModFile(base, mod.prefix, patchRel);
      if (patchText !== undefined && content !== undefined) {
        if (logicalPath.endsWith(".md")) {
          content = mergeMarkdownWithPatch(content, patchText);
        } else if (logicalPath.endsWith(".yaml")) {
          const baseDoc = parseYaml(content);
          content = stringifyYaml(applyPatchMerge(baseDoc, parseYaml(patchText)));
        }
        layer = { layer: "mod", id: mod.modId };
        winningModPrefix = mod.prefix;
      }
      const appendRel = appendPathFor(logicalPath);
      if (appendRel) {
        const appendText = await readModFile(base, mod.prefix, appendRel);
        if (appendText !== undefined) {
          appends.push(appendText);
          layer = { layer: "mod", id: mod.modId };
          winningModPrefix = mod.prefix;
        }
      }
    }

    if (winningModPrefix && content !== undefined) {
      content = await applyModLocaleOverlays(winningModPrefix, logicalPath, content);
    }

    if (content === undefined) return undefined;
    if (appends.length) {
      for (const append of appends) {
        content = mergeMarkdownAppend(content!, append);
      }
    }
    setProv(logicalPath, layer);
    return content;
  }

  return {
    root: base.root,
    readText(path) {
      return resolveLogicalText(path);
    },
    readBytes(path) {
      return resolveLogicalText(path).then((t) => (t === undefined ? undefined : new TextEncoder().encode(t)));
    },
    writeAtomic() {
      return Promise.reject(new Error("LayeredStorage is read-only"));
    },
    append() {
      return Promise.reject(new Error("LayeredStorage is read-only"));
    },
    exists(path) {
      return resolveLogicalText(path).then((t) => t !== undefined);
    },
    async list(dir) {
      const d = dir ?? "";
      const prefix = d ? `${d}/` : "";
      const names = new Set<string>();
      for (const path of await allLogicalPaths()) {
        if (d && !path.startsWith(prefix)) continue;
        const rest = d ? path.slice(prefix.length) : path;
        if (!rest) continue;
        const slash = rest.indexOf("/");
        if (slash >= 0) names.add(`${rest.slice(0, slash + 1)}`);
      }
      for (const n of await base.list(dir)) {
        if (n.startsWith("mods")) continue;
        names.add(n);
      }
      return [...names].sort();
    },
    async listFiles(dir) {
      const d = dir ?? "";
      const prefix = d ? `${d}/` : "";
      const fromLogical = (await allLogicalPaths()).filter((p) => d === "" || p.startsWith(prefix));
      const fromBase = await base.listFiles(dir);
      return [...new Set([...fromLogical, ...fromBase])].sort();
    },
    mkdir() {
      return Promise.reject(new Error("LayeredStorage is read-only"));
    },
    remove() {
      return Promise.reject(new Error("LayeredStorage is read-only"));
    },
    async stat(path) {
      const text = await resolveLogicalText(path);
      if (text === undefined) return undefined;
      let mtimeMs = 0;
      if (typeof base.stat === "function") {
        const b = await base.stat(path);
        if (b) mtimeMs = Math.max(mtimeMs, b.mtimeMs);
        for (const mod of modLayers) {
          for (const rel of [path, patchPathFor(path), appendPathFor(path)].filter(Boolean) as string[]) {
            const st = await base.stat(modOverlayPath(mod.prefix, rel));
            if (st) mtimeMs = Math.max(mtimeMs, st.mtimeMs);
          }
        }
      }
      return { size: text.length, mtimeMs: mtimeMs || Date.now(), isDir: false };
    },
    acquireLock: () => base.acquireLock(),
    releaseLock: () => base.releaseLock(),
  };
}
