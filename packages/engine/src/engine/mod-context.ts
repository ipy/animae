import type { CreateEngineOptions } from "../api.ts";
import type { StoragePort } from "../ports.ts";
import { AnimaeConfigSchema } from "../schema/authored.ts";
import { parseYaml } from "../store/util.ts";
import { prepareModOverlay, type ModOverlayContext } from "../mods/prepare.ts";
import type { ModBundle } from "../mod.ts";
import { createLocaleOverlayStorage } from "../i18n/locale-storage.ts";
import { resolveEngineI18n } from "../i18n/resolve-config.ts";

export interface EngineModContext {
  overlay: ModOverlayContext;
  readStorage: StoragePort;
  configMods: string[];
  selection?: CreateEngineOptions["mods"];
  bundles: ModBundle[];
  i18n: ReturnType<typeof resolveEngineI18n>;
}

export async function createEngineModContext(
  baseStorage: StoragePort,
  opts: CreateEngineOptions,
): Promise<EngineModContext> {
  const configText = await baseStorage.readText("animae.yaml");
  const config = AnimaeConfigSchema.parse(parseYaml(configText ?? "{}"));
  const i18n = resolveEngineI18n(config.i18n, opts);
  const localizedBase = createLocaleOverlayStorage({ base: baseStorage, localeChain: i18n.contentLocaleChain });
  const { readStorage, ...overlay } = await prepareModOverlay(localizedBase, config.mods ?? [], {
    selection: opts.mods,
    bundles: opts.modBundles,
    engineVersion: "1.0.0",
    contentLocaleChain: i18n.contentLocaleChain,
  });
  return {
    overlay,
    readStorage,
    configMods: config.mods ?? [],
    selection: opts.mods,
    bundles: opts.modBundles ?? [],
    i18n,
  };
}

export async function refreshEngineModContext(
  baseStorage: StoragePort,
  ctx: EngineModContext,
): Promise<EngineModContext> {
  // Same layering as `createEngineModContext`: a refreshed view that skipped the locale overlay would read the
  // unlocalized base files, so the first hot-reload check would silently swap the content the session started with.
  const localizedBase = createLocaleOverlayStorage({ base: baseStorage, localeChain: ctx.i18n.contentLocaleChain });
  const { readStorage, ...overlay } = await prepareModOverlay(localizedBase, ctx.configMods, {
    selection: ctx.selection,
    bundles: ctx.bundles,
    engineVersion: "1.0.0",
    contentLocaleChain: ctx.i18n.contentLocaleChain,
  });
  return { ...ctx, overlay, readStorage };
}
