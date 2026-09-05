import type { StoragePort } from "../ports.ts";
import type { PresetRegistry } from "../contracts.ts";
import type { Authored, FieldDef, Template } from "../schema/authored.ts";
import {
  AnchorsFileSchema,
  AnimaeConfigSchema,
  BeatsFileSchema,
  ExceptionsFileSchema,
  FieldDefSchema,
  ItemDefSchema,
  LocationDefSchema,
  ScheduleFileSchema,
  TemplateSchema,
  WorldDefSchema,
} from "../schema/authored.ts";
import { parseYaml, sha256Hex } from "../store/util.ts";
import { loadCharacterFromFiles } from "./characters.ts";
import { type ConfigIssue, throwConfigInvalid, zodIssues } from "./errors.ts";
import { parseKnowledgeMarkdown } from "./knowledge.ts";
import { crossReferenceAuthored } from "./validate.ts";
import type { ModProvenanceEntry, ResolvedMod } from "../mod.ts";
import { modFingerprint } from "../mods/resolve.ts";

export async function loadAuthored(
  storage: StoragePort,
  opts?: {
    presets?: PresetRegistry;
    extraKnowledge?: Record<string, string>;
    resolvedMods?: ResolvedMod[];
    modProvenance?: Map<string, ModProvenanceEntry>;
  },
): Promise<Authored> {
  const issues: ConfigIssue[] = [];
  const fileHashes: Record<string, string> = {};

  async function readTracked(path: string): Promise<string | undefined> {
    const text = await storage.readText(path);
    if (text !== undefined) fileHashes[path] = sha256Hex(text);
    return text;
  }

  async function loadRequiredYaml<T>(path: string, schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } }): Promise<T | undefined> {
    const text = await readTracked(path);
    if (text === undefined) {
      issues.push({ file: path, path: "(root)", message: "file not found" });
      return undefined;
    }
    const raw = parseYaml(text);
    const r = schema.safeParse(raw);
    if (!r.success) {
      issues.push(...zodIssues(path, r.error));
      return undefined;
    }
    return r.data;
  }

  async function loadOptionalArrayFile<T>(
    path: string,
    schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } },
  ): Promise<T> {
    const text = await readTracked(path);
    if (text === undefined) return [] as T;
    const raw = parseYaml(text);
    const r = schema.safeParse(raw);
    if (!r.success) {
      issues.push(...zodIssues(path, r.error));
      return [] as T;
    }
    return r.data;
  }

  const config = (await loadRequiredYaml("animae.yaml", AnimaeConfigSchema)) ?? AnimaeConfigSchema.parse({});
  const world = (await loadRequiredYaml("world/world.yaml", WorldDefSchema)) ?? WorldDefSchema.parse({});

  const locations: Authored["locations"] = {};
  const locFiles = (await storage.listFiles("world/locations")).filter((p) => p.endsWith(".yaml"));
  for (const path of locFiles) {
    const text = await readTracked(path);
    if (text === undefined) continue;
    const r = LocationDefSchema.safeParse(parseYaml(text));
    if (!r.success) {
      issues.push(...zodIssues(path, r.error));
      continue;
    }
    if (locations[r.data.id]) {
      issues.push({ file: path, path: "id", message: `duplicate location id "${r.data.id}"` });
    }
    locations[r.data.id] = r.data;
  }

  const items: Authored["items"] = {};
  for (const path of (await storage.listFiles("world/items")).filter((p) => p.endsWith(".yaml"))) {
    const text = await readTracked(path);
    if (text === undefined) continue;
    const r = ItemDefSchema.safeParse(parseYaml(text));
    if (!r.success) {
      issues.push(...zodIssues(path, r.error));
      continue;
    }
    if (items[r.data.id]) issues.push({ file: path, path: "id", message: `duplicate item id "${r.data.id}"` });
    items[r.data.id] = r.data;
  }

  const fields: Authored["fields"] = {};
  for (const path of (await storage.listFiles("world/fields")).filter((p) => p.endsWith(".yaml"))) {
    const text = await readTracked(path);
    if (text === undefined) continue;
    const raw = parseYaml(text);
    const defs: FieldDef[] = Array.isArray(raw) ? raw : [raw];
    for (let i = 0; i < defs.length; i++) {
      const r = FieldDefSchema.safeParse(defs[i]);
      if (!r.success) {
        issues.push(...zodIssues(path, r.error).map((iss) => ({ ...iss, path: Array.isArray(raw) ? `${iss.path}[${i}]` : iss.path })));
        continue;
      }
      if (fields[r.data.id]) issues.push({ file: path, path: "id", message: `duplicate field id "${r.data.id}"` });
      fields[r.data.id] = r.data;
    }
  }

  const anchors = await loadOptionalArrayFile("world/anchors.yaml", AnchorsFileSchema);
  const beats = await loadOptionalArrayFile("world/beats.yaml", BeatsFileSchema);
  const exceptionsList = await loadOptionalArrayFile("world/exceptions.yaml", ExceptionsFileSchema);
  const exceptions: Authored["exceptions"] = {};
  for (const ex of exceptionsList) {
    if (exceptions[ex.id]) issues.push({ file: "world/exceptions.yaml", path: "id", message: `duplicate exception "${ex.id}"` });
    exceptions[ex.id] = ex;
  }
  const schedule = await loadOptionalArrayFile("world/schedule.yaml", ScheduleFileSchema);

  const knowledge: Authored["knowledge"] = [];
  for (const path of (await storage.listFiles("world/knowledge")).filter((p) => p.endsWith(".md"))) {
    const text = await readTracked(path);
    if (text === undefined) continue;
    const rel = path;
    const { doc, issues: kIssues } = parseKnowledgeMarkdown(path, rel, text);
    issues.push(...kIssues);
    if (doc) knowledge.push(doc);
  }
  knowledge.sort((a, b) => a.id.localeCompare(b.id));

  const templates: Authored["templates"] = { character: {}, location: {}, item: {} };
  for (const kind of ["character", "location", "item"] as const) {
    const dir = `templates/${kind}`;
    for (const path of (await storage.listFiles(dir)).filter((p) => p.endsWith(".yaml"))) {
      const text = await readTracked(path);
      if (text === undefined) continue;
      const r = TemplateSchema.safeParse(parseYaml(text));
      if (!r.success) {
        issues.push(...zodIssues(path, r.error));
        continue;
      }
      const tid = r.data.id ?? path.split("/").pop()!.replace(/\.yaml$/, "");
      const tpl: Template = { ...r.data, id: tid, kind };
      if (templates[kind][tid]) issues.push({ file: path, path: "id", message: `duplicate template "${tid}"` });
      templates[kind][tid] = tpl;
    }
  }

  mergePresets(opts?.presets, templates, knowledge, fileHashes, issues);

  if (opts?.extraKnowledge) {
    for (const [rel, text] of Object.entries(opts.extraKnowledge)) {
      const path = rel.startsWith("world/knowledge/") ? rel : `world/knowledge/${rel}`;
      fileHashes[path] = sha256Hex(text);
      const { doc, issues: kIssues } = parseKnowledgeMarkdown(path, path, text);
      issues.push(...kIssues);
      if (doc && !knowledge.some((k) => k.id === doc.id)) knowledge.push(doc);
    }
    knowledge.sort((a, b) => a.id.localeCompare(b.id));
  }

  const characters: Authored["characters"] = {};
  const charDirs = (await storage.list("characters")).filter((n) => n.endsWith("/")).map((n) => n.slice(0, -1));
  for (const charId of charDirs) {
    const allPaths = await storage.listFiles(`characters/${charId}`);
    const fileContents: { path: string; content: string; hash: string }[] = [];
    for (const path of allPaths) {
      const text = await readTracked(path);
      if (text === undefined) continue;
      fileContents.push({ path, content: text, hash: fileHashes[path]! });
    }
    const loaded = loadCharacterFromFiles(charId, fileContents);
    issues.push(...loaded.issues);
    Object.assign(fileHashes, loaded.fileHashes);
    if (!loaded.issues.some((i) => i.path === "card.md" && i.message === "missing card.md")) {
      characters[charId] = loaded.def;
    }
  }

  if (issues.length) throwConfigInvalid(issues);

  if (opts?.resolvedMods?.length) {
    fileHashes["__mods__"] = modFingerprint(opts.resolvedMods);
  }

  const authored: Authored = {
    config,
    world,
    locations,
    items,
    fields,
    anchors,
    beats,
    exceptions,
    schedule,
    knowledge,
    characters,
    templates,
    hash: aggregateHash(fileHashes),
    files: fileHashes,
    mods: opts?.resolvedMods,
    modProvenance: opts?.modProvenance ? Object.fromEntries(opts.modProvenance) : undefined,
  };

  const xrefIssues = crossReferenceAuthored(authored, () => {});
  if (xrefIssues.length) throwConfigInvalid(xrefIssues);

  return authored;
}

function mergePresets(
  presets: PresetRegistry | undefined,
  templates: Authored["templates"],
  knowledge: Authored["knowledge"],
  fileHashes: Record<string, string>,
  issues: ConfigIssue[],
): void {
  if (!presets) return;
  for (const bundle of presets.list()) {
    for (const t of bundle.templates ?? []) {
      if (templates[t.kind][t.id]) continue;
      const r = TemplateSchema.safeParse(t.template);
      if (!r.success) {
        issues.push(...zodIssues(`preset:${bundle.id}:template:${t.id}`, r.error));
        continue;
      }
      templates[t.kind][t.id] = { ...r.data, id: t.id, kind: t.kind };
    }
    for (const [rel, text] of Object.entries(bundle.knowledge ?? {})) {
      if (!rel.endsWith(".md") && !rel.endsWith(".markdown")) continue;
      const path = rel.startsWith("world/knowledge/") ? rel : `world/knowledge/${rel}`;
      if (knowledge.some((k) => k.path === path)) continue;
      fileHashes[path] = sha256Hex(text);
      const { doc, issues: kIssues } = parseKnowledgeMarkdown(path, path, text);
      issues.push(...kIssues);
      if (doc) knowledge.push(doc);
    }
  }
  knowledge.sort((a, b) => a.id.localeCompare(b.id));
}

function aggregateHash(files: Record<string, string>): string {
  const keys = Object.keys(files).sort();
  return sha256Hex(keys.map((k) => `${k}\0${files[k]}`).join("\n"));
}
