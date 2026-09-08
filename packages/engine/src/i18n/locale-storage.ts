import type { StoragePort } from "../ports.ts";
import { applyPatchMerge } from "../mods/patch-merge.ts";
import { parseFrontmatter, parseYaml, stringifyYaml } from "../store/util.ts";

export interface LocaleStorageLayerOptions {
  base: StoragePort;
  /** ordered BCP-47 tags (primary first) */
  localeChain: readonly string[];
}

function patchPathFor(logicalPath: string): string {
  if (logicalPath.endsWith(".yaml")) return logicalPath.replace(/\.yaml$/, ".patch.yaml");
  if (logicalPath.endsWith(".md")) return logicalPath.replace(/\.md$/, ".patch.yaml");
  return `${logicalPath}.patch.yaml`;
}

function localePrefix(locale: string): string {
  return `locales/${locale}`;
}

function mergeMarkdownWithPatch(content: string, patchYaml: string): string {
  const { data, body } = parseFrontmatter(content);
  const patchDoc = parseYaml(patchYaml);
  const merged = applyPatchMerge(data, patchDoc) as Record<string, unknown>;
  const fm = stringifyYaml(merged).trimEnd();
  return `---\n${fm}\n---\n${body}`;
}

/**
 * Read-only view: base authored tree with locale overlays (`locales/<locale>/…`) applied before mods.
 */
export function createLocaleOverlayStorage(opts: LocaleStorageLayerOptions): StoragePort {
  const { base, localeChain } = opts;

  async function readLocaleFile(locale: string, logicalPath: string): Promise<string | undefined> {
    return base.readText(`${localePrefix(locale)}/${logicalPath}`);
  }

  async function resolveLogicalText(logicalPath: string): Promise<string | undefined> {
    let content = await base.readText(logicalPath);
    for (const locale of localeChain) {
      const full = await readLocaleFile(locale, logicalPath);
      if (full !== undefined) content = full;
      const patchText = await readLocaleFile(locale, patchPathFor(logicalPath));
      if (patchText !== undefined && content !== undefined) {
        if (logicalPath.endsWith(".md")) content = mergeMarkdownWithPatch(content, patchText);
        else if (logicalPath.endsWith(".yaml")) {
          const baseDoc = parseYaml(content);
          content = stringifyYaml(applyPatchMerge(baseDoc, parseYaml(patchText)));
        }
      }
      const appendPath = logicalPath.endsWith("card.md") ? logicalPath.replace(/card\.md$/, "card.append.md") : undefined;
      if (appendPath) {
        const append = await readLocaleFile(locale, appendPath);
        if (append !== undefined && content !== undefined) content = `${content.trimEnd()}\n\n${append.trim()}\n`;
      }
    }
    return content;
  }

  return {
    root: base.root,
    readText(path: string) {
      if (path.startsWith("locales/")) return base.readText(path);
      return resolveLogicalText(path);
    },
    readBytes(path: string) {
      return resolveLogicalText(path).then((t) => (t === undefined ? undefined : new TextEncoder().encode(t)));
    },
    writeAtomic() {
      return Promise.reject(new Error("LocaleOverlayStorage is read-only"));
    },
    append() {
      return Promise.reject(new Error("LocaleOverlayStorage is read-only"));
    },
    exists(path: string) {
      if (path.startsWith("locales/")) return base.exists(path);
      return resolveLogicalText(path).then((t) => t !== undefined);
    },
    async list(dir) {
      const raw = await base.list(dir);
      return raw.filter((p) => !p.startsWith("locales/"));
    },
    async listFiles(dir) {
      const raw = await base.listFiles(dir);
      return raw.filter((p) => !p.startsWith("locales/"));
    },
    mkdir() {
      return Promise.reject(new Error("LocaleOverlayStorage is read-only"));
    },
    remove() {
      return Promise.reject(new Error("LocaleOverlayStorage is read-only"));
    },
    async stat(path) {
      if (path.startsWith("locales/")) return base.stat(path);
      const text = await resolveLogicalText(path);
      if (text === undefined) return undefined;
      const b = await base.stat(path);
      return { size: text.length, mtimeMs: b?.mtimeMs ?? Date.now(), isDir: false };
    },
    acquireLock: () => base.acquireLock(),
    releaseLock: () => base.releaseLock(),
  };
}
