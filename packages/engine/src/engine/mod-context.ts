import type { CreateEngineOptions } from "../api.ts";
import type { StoragePort } from "../ports.ts";
import { AnimaeConfigSchema } from "../schema/authored.ts";
import { parseYaml } from "../store/util.ts";
import { prepareModOverlay, type ModOverlayContext } from "../mods/prepare.ts";
import type { ModBundle } from "../mod.ts";

export interface EngineModContext {
  overlay: ModOverlayContext;
  readStorage: StoragePort;
  configMods: string[];
  selection?: CreateEngineOptions["mods"];
  bundles: ModBundle[];
}

export async function createEngineModContext(
  baseStorage: StoragePort,
  opts: CreateEngineOptions,
): Promise<EngineModContext> {
  const configText = await baseStorage.readText("animae.yaml");
  const config = AnimaeConfigSchema.parse(parseYaml(configText ?? "{}"));
  const { readStorage, ...overlay } = await prepareModOverlay(baseStorage, config.mods ?? [], {
    selection: opts.mods,
    bundles: opts.modBundles,
    engineVersion: "1.0.0",
  });
  return {
    overlay,
    readStorage,
    configMods: config.mods ?? [],
    selection: opts.mods,
    bundles: opts.modBundles ?? [],
  };
}

export async function refreshEngineModContext(
  baseStorage: StoragePort,
  ctx: EngineModContext,
): Promise<EngineModContext> {
  const { readStorage, ...overlay } = await prepareModOverlay(baseStorage, ctx.configMods, {
    selection: ctx.selection,
    bundles: ctx.bundles,
    engineVersion: "1.0.0",
  });
  return { ...ctx, overlay, readStorage };
}
