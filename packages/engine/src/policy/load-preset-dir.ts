import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import type { StoragePort } from "../ports.ts";
import type { PresetBundle } from "../preset.ts";
import { AnimaeError } from "../types.ts";
import { parseYaml } from "../store/util.ts";

async function readPresetYamlFromFs(root: string): Promise<{ id: string; extends: string[]; policies: string[] }> {
  const text = await readFile(join(root, "preset.yaml"), "utf8");
  const doc = parseYaml(text) as Record<string, unknown>;
  const id = doc.id;
  if (typeof id !== "string" || !id) {
    throw new AnimaeError("CONFIG_INVALID", `${root}/preset.yaml: missing preset id`);
  }
  const extendsList = Array.isArray(doc.extends) ? doc.extends.filter((x): x is string => typeof x === "string") : [];
  const policies = Array.isArray(doc.policies) ? doc.policies.filter((x): x is string => typeof x === "string") : [];
  return { id, extends: extendsList, policies };
}

async function loadPolicyDocFs(root: string, rel: string): Promise<{ name: string; doc: unknown }> {
  const abs = join(root, rel);
  const name = rel;
  if (rel.endsWith(".yaml") || rel.endsWith(".yml")) {
    const text = await readFile(abs, "utf8");
    return { name, doc: parseYaml(text) };
  }
  if (rel.endsWith(".ts") || rel.endsWith(".js")) {
    const mod = (await import(pathToFileURL(abs).href)) as { default?: unknown };
    if (mod.default === undefined) {
      throw new AnimaeError("CONFIG_INVALID", `${rel}: policy module must default-export a document`);
    }
    return { name, doc: mod.default };
  }
  throw new AnimaeError("CONFIG_INVALID", `${rel}: policy file must be .yaml or .ts`);
}

async function collectKnowledgeFs(root: string, sub: string): Promise<Record<string, string>> {
  const dir = join(root, sub);
  const out: Record<string, string> = {};
  try {
    await walk(dir, dir, out);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  return out;
}

async function walk(base: string, dir: string, out: Record<string, string>): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) await walk(base, full, out);
    else if (ent.isFile() && (ent.name.endsWith(".md") || ent.name.endsWith(".markdown"))) {
      const rel = relative(base, full).replaceAll("\\", "/");
      out[rel] = await readFile(full, "utf8");
    }
  }
}

/** Load a filesystem preset directory into a `PresetBundle`. */
export async function loadPresetDir(pathOrStorage: string | StoragePort): Promise<PresetBundle> {
  if (typeof pathOrStorage === "string") {
    const root = pathOrStorage;
    const meta = await readPresetYamlFromFs(root);
    const policies: PresetBundle["policies"] = [];
    for (const rel of meta.policies) {
      policies.push(await loadPolicyDocFs(root, rel));
    }
    const knowledge: Record<string, string> = {
      ...(await collectKnowledgeFs(root, "knowledge")),
      ...(await collectKnowledgeFs(root, "templates")),
    };
    return {
      id: meta.id,
      extends: meta.extends,
      policies,
      knowledge: Object.keys(knowledge).length ? knowledge : undefined,
    };
  }

  const storage = pathOrStorage;
  const yamlText = await storage.readText("preset.yaml");
  if (yamlText === undefined) {
    throw new AnimaeError("CONFIG_INVALID", "preset.yaml: not found");
  }
  const doc = parseYaml(yamlText) as Record<string, unknown>;
  const id = doc.id;
  if (typeof id !== "string" || !id) {
    throw new AnimaeError("CONFIG_INVALID", "preset.yaml: missing preset id");
  }
  const extendsList = Array.isArray(doc.extends) ? doc.extends.filter((x): x is string => typeof x === "string") : [];
  const policyPaths = Array.isArray(doc.policies) ? doc.policies.filter((x): x is string => typeof x === "string") : [];
  const policies: PresetBundle["policies"] = [];
  for (const rel of policyPaths) {
    policies.push(await loadPolicyDocFromStorage(storage, rel));
  }
  const knowledge = await collectKnowledgeStorage(storage, "knowledge");
  const templates = await collectKnowledgeStorage(storage, "templates");
  const mergedKnowledge = { ...templates, ...knowledge };
  return {
    id,
    extends: extendsList,
    policies,
    knowledge: Object.keys(mergedKnowledge).length ? mergedKnowledge : undefined,
  };
}

async function loadPolicyDocFromStorage(storage: StoragePort, rel: string): Promise<{ name: string; doc: unknown }> {
  if (rel.endsWith(".yaml") || rel.endsWith(".yml")) {
    const text = await storage.readText(rel);
    if (text === undefined) throw new AnimaeError("CONFIG_INVALID", `${rel}: not found`);
    return { name: rel, doc: parseYaml(text) };
  }
  if (rel.endsWith(".ts") || rel.endsWith(".js")) {
    const abs = join(storage.root, rel);
    const mod = (await import(pathToFileURL(abs).href)) as { default?: unknown };
    if (mod.default === undefined) {
      throw new AnimaeError("CONFIG_INVALID", `${rel}: policy module must default-export a document`);
    }
    return { name: rel, doc: mod.default };
  }
  throw new AnimaeError("CONFIG_INVALID", `${rel}: policy file must be .yaml or .ts`);
}

async function collectKnowledgeStorage(storage: StoragePort, dir: string): Promise<Record<string, string>> {
  const files = await storage.listFiles(dir);
  const out: Record<string, string> = {};
  for (const f of files) {
    if (f.endsWith(".md") || f.endsWith(".markdown")) {
      const text = await storage.readText(f);
      if (text !== undefined) out[f] = text;
    }
  }
  return out;
}
