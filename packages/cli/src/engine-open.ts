import {
  AnimaeError,
  AnimaeConfigSchema,
  createEngine,
  createPresetRegistry,
  FsStorage,
  loadAuthored,
  loadPolicy,
  parseYaml,
  resolvePresetChain,
  type CreateEngineOptions,
  type Engine,
  type ImagePort,
  type ModelMode,
  type PresetBundle,
  type PresetRegistry,
  type RuntimeModePreset,
  type RuntimeModeRequest,
} from "@animae/engine";
import { builtinPresets } from "./presets.ts";

export interface OpenEngineOptions {
  root: string;
  modelMode?: ModelMode;
  /** Runtime mode to start in (CLI `--mode`); overrides `animae.yaml`. Recorded as `reason: "cli"`. */
  mode?: RuntimeModePreset | RuntimeModeRequest;
  seed?: number;
  lang?: string;
  models?: CreateEngineOptions["models"];
  /** extra presets registered for lookup (extends chain) */
  presets?: PresetBundle[];
  ports?: { image?: ImagePort };
}

export async function fullPresetRegistry(extra: PresetBundle[] = []): Promise<PresetRegistry> {
  return createPresetRegistry([...(await builtinPresets()), ...extra]);
}

async function activePresetBundles(registry: PresetRegistry, root: string): Promise<PresetBundle[]> {
  const storage = FsStorage(root);
  const text = await storage.readText("animae.yaml");
  if (!text) return [];
  const config = AnimaeConfigSchema.safeParse(parseYaml(text));
  if (!config.success || !config.data.preset) return [];
  return resolvePresetChain(registry, config.data.preset);
}

export async function presetRegistry(extra: PresetBundle[] = []): Promise<PresetRegistry> {
  return fullPresetRegistry(extra);
}

export async function validateDataRoot(
  root: string,
  extraPresets: PresetBundle[] = [],
): Promise<{ ok: boolean; issues: { file: string; path: string; message: string }[] }> {
  const registry = await fullPresetRegistry(extraPresets);
  const storage = FsStorage(root);
  const active = await activePresetBundles(registry, root);
  const mergeRegistry = createPresetRegistry(active);
  const issues: { file: string; path: string; message: string }[] = [];

  try {
    const authored = await loadAuthored(storage, { presets: mergeRegistry });
    await loadPolicy(storage, authored.config, registry, {
      authoredFields: Object.fromEntries(Object.entries(authored.fields).map(([id, f]) => [id, { level: f.level }])),
    });
  } catch (err) {
    if (err instanceof AnimaeError && err.code === "CONFIG_INVALID") {
      const detailIssues = (err.details as { issues?: typeof issues } | undefined)?.issues;
      if (detailIssues?.length) issues.push(...detailIssues);
      else {
        for (const line of err.message.split("\n")) {
          if (!line.trim()) continue;
          const m = /^([^:]+):([^:]+): (.*)$/.exec(line);
          issues.push(m ? { file: m[1]!, path: m[2]!, message: m[3]! } : { file: "(root)", path: "(root)", message: line });
        }
      }
      return { ok: false, issues };
    }
    issues.push({ file: "(root)", path: "(root)", message: err instanceof Error ? err.message : String(err) });
    return { ok: false, issues };
  }

  return { ok: true, issues: [] };
}

export async function openEngine(opts: OpenEngineOptions): Promise<Engine> {
  const registry = await fullPresetRegistry(opts.presets ?? []);
  const bundles = await activePresetBundles(registry, opts.root);
  return createEngine({
    root: opts.root,
    presets: bundles,
    modelMode: opts.modelMode,
    ...(opts.mode !== undefined ? { mode: opts.mode, modeSource: { reason: "cli" as const, trigger: "cli:--mode" } } : {}),
    seed: opts.seed,
    models: opts.models,
    i18n: opts.lang ? { locale: opts.lang } : undefined,
    ports: opts.ports,
  });
}
