import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { StoragePort } from "../ports.ts";
import { parseYaml } from "../store/util.ts";
import { AnimaeError } from "../types.ts";

export async function loadPolicyDocFromPath(storage: StoragePort, rel: string): Promise<{ name: string; doc: unknown }> {
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
