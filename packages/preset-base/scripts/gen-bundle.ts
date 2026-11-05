import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const pkgRoot = join(fileURLToPath(new URL("..", import.meta.url)));

async function readPresetMeta(): Promise<{ id: string; extends: string[]; policies: string[] }> {
  const text = await readFile(join(pkgRoot, "preset.yaml"), "utf8");
  const doc = parseYaml(text) as Record<string, unknown>;
  const id = String(doc.id ?? "");
  const extendsList = Array.isArray(doc.extends) ? doc.extends.filter((x): x is string => typeof x === "string") : [];
  const policies = Array.isArray(doc.policies) ? doc.policies.filter((x): x is string => typeof x === "string") : [];
  return { id, extends: extendsList, policies };
}

async function loadPolicy(rel: string): Promise<{ name: string; doc: unknown }> {
  const text = await readFile(join(pkgRoot, rel), "utf8");
  return { name: rel, doc: parseYaml(text) };
}

async function walkMd(base: string, dir: string, out: Record<string, string>): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) await walkMd(base, full, out);
    else if (ent.isFile() && (ent.name.endsWith(".md") || ent.name.endsWith(".markdown") || ent.name.endsWith(".yaml"))) {
      const rel = relative(base, full).replaceAll("\\", "/");
      out[rel] = await readFile(full, "utf8");
    }
  }
}

async function collectKnowledge(): Promise<Record<string, string> | undefined> {
  const out: Record<string, string> = {};
  for (const sub of ["knowledge", "templates"]) {
    await walkMd(join(pkgRoot, sub), join(pkgRoot, sub), out);
  }
  return Object.keys(out).length ? out : undefined;
}

function flattenStringTable(obj: Record<string, unknown>, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out[path] = value;
    else if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(out, flattenStringTable(value as Record<string, unknown>, path));
    }
  }
  return out;
}

/** `locales/<locale>/strings.yaml` of every locale directory the package ships, as flat key tables. */
async function collectDisplayStrings(): Promise<Record<string, Record<string, string>> | undefined> {
  const out: Record<string, Record<string, string>> = {};
  const base = join(pkgRoot, "locales");
  let entries;
  try {
    entries = await readdir(base, { withFileTypes: true });
  } catch {
    return undefined;
  }
  for (const ent of entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    try {
      const text = await readFile(join(base, ent.name, "strings.yaml"), "utf8");
      out[ent.name] = flattenStringTable(parseYaml(text) as Record<string, unknown>);
    } catch {
      /* a locale directory without a string table is skipped */
    }
  }
  return Object.keys(out).length ? out : undefined;
}

function serializeValue(value: unknown, indent: number): string {
  if (value === undefined) return "undefined";
  const pad = " ".repeat(indent);
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return `[\n${value.map((v) => `${pad}  ${serializeValue(v, indent + 2)},`).join("\n")}\n${pad}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    return `{\n${entries.map(([k, v]) => `${pad}  ${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${serializeValue(v, indent + 2)},`).join("\n")}\n${pad}}`;
  }
  return JSON.stringify(value);
}

export async function buildPresetBundleObject(): Promise<Record<string, unknown>> {
  const meta = await readPresetMeta();
  const policies = [];
  for (const rel of meta.policies) policies.push(await loadPolicy(rel));
  const knowledge = await collectKnowledge();
  const displayStrings = await collectDisplayStrings();
  return {
    id: meta.id,
    extends: meta.extends,
    policies,
    ...(knowledge ? { knowledge } : {}),
    ...(displayStrings ? { displayStrings } : {}),
  };
}

async function main(): Promise<void> {
  const bundle = await buildPresetBundleObject();
  const body = serializeValue(bundle, 0);
  const out = `/** Generated from YAML by scripts/gen-bundle.ts — do not edit by hand. */\nimport type { PresetBundle } from "@animae/engine";\n\nexport const generatedBundle = ${body} as PresetBundle;\n`;
  await Bun.write(join(pkgRoot, "src/generated.ts"), out);
  console.log("wrote src/generated.ts");
}

if (import.meta.main) {
  await main();
}
