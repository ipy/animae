import {
  AnimaeConfigSchema,
  FsStorage,
  createLayeredStorage,
  explainAuthoredPath,
  formatExplainLine,
  loadAuthored,
  loadModManifestFromDir,
  loadPolicy,
  parseYaml,
  prepareModOverlay,
  resolveMods,
} from "@animae/engine";
import { fullPresetRegistry } from "../engine-open.ts";

export async function runModsList(root: string): Promise<number> {
  const storage = FsStorage(root);
  const entries = await storage.list("mods");
  const ids = entries.filter((e) => e.endsWith("/")).map((e) => e.slice(0, -1));
  const configText = await storage.readText("animae.yaml");
  const enabled = new Set(AnimaeConfigSchema.parse(parseYaml(configText ?? "{}")).mods ?? []);
  for (const id of ids.sort()) {
    const m = await loadModManifestFromDir(storage, id);
    if (!m) continue;
    const mark = enabled.has(id) ? "*" : " ";
    process.stdout.write(`${mark} ${m.id}\t${m.version}\t${m.name}${m.rating ? `\t[rating:${m.rating}]` : ""}\n`);
  }
  return 0;
}

export async function runModsValidate(root: string, modIds?: string[]): Promise<number> {
  const storage = FsStorage(root);
  const configText = await storage.readText("animae.yaml");
  const config = AnimaeConfigSchema.parse(parseYaml(configText ?? "{}"));
  const ids = modIds ?? config.mods ?? [];
  try {
    await resolveMods(storage, ids, { engineVersion: "1.0.0" });
    process.stdout.write("OK\n");
    return 0;
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

export async function runModsExplain(root: string, path: string, modIds?: string[]): Promise<number> {
  const storage = FsStorage(root);
  const registry = await fullPresetRegistry();
  const configText = await storage.readText("animae.yaml");
  const config = AnimaeConfigSchema.parse(parseYaml(configText ?? "{}"));
  const selection = modIds ?? config.mods ?? [];
  const { ordered, layers, provenance } = await prepareModOverlay(storage, config.mods ?? [], {
    selection,
    engineVersion: "1.0.0",
  });
  const readStorage = createLayeredStorage({ base: storage, modLayers: layers, provenance });
  await loadAuthored(readStorage, { presets: registry, resolvedMods: ordered, modProvenance: provenance });
  const line = explainAuthoredPath(provenance, path);
  if (!line) {
    process.stdout.write(`${path}\t(not loaded — missing or invalid)\n`);
    return 1;
  }
  process.stdout.write(`${formatExplainLine(line)}\n`);
  return 0;
}

export async function validateWithMods(root: string, modIds?: string[]): Promise<{ ok: boolean; issues: { file: string; path: string; message: string }[] }> {
  const storage = FsStorage(root);
  const registry = await fullPresetRegistry();
  const configText = await storage.readText("animae.yaml");
  const config = AnimaeConfigSchema.parse(parseYaml(configText ?? "{}"));
  const selection = modIds ?? config.mods;
  try {
    const { readStorage, ordered, provenance } = await prepareModOverlay(storage, config.mods ?? [], {
      selection,
      engineVersion: "1.0.0",
    });
    const authored = await loadAuthored(readStorage, {
      presets: registry,
      resolvedMods: ordered,
      modProvenance: provenance,
    });
    await loadPolicy(readStorage, authored.config, registry, {
      authoredFields: Object.fromEntries(Object.entries(authored.fields).map(([id, f]) => [id, { level: f.level }])),
    });
    return { ok: true, issues: [] };
  } catch (err) {
    const { AnimaeError } = await import("@animae/engine");
    if (err instanceof AnimaeError && (err.code === "CONFIG_INVALID" || err.code === "MOD_CONFIG")) {
      const detailIssues = (err.details as { issues?: { file: string; path: string; message: string }[] } | undefined)?.issues;
      if (detailIssues?.length) return { ok: false, issues: detailIssues };
      return {
        ok: false,
        issues: [{ file: "(root)", path: "(root)", message: err.message }],
      };
    }
    return { ok: false, issues: [{ file: "(root)", path: "(root)", message: err instanceof Error ? err.message : String(err) }] };
  }
}
