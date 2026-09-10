import type { Kernel } from "../contracts.ts";
import type { Authored } from "../schema/authored.ts";
import { loadAuthored } from "../authored/load.ts";
import { loadPolicy } from "../policy/load.ts";
import type { PresetRegistry } from "../contracts.ts";
import type { StoragePort } from "../ports.ts";
import { sha256Hex } from "../store/util.ts";
import type { EngineModContext } from "./mod-context.ts";
import { refreshEngineModContext } from "./mod-context.ts";
import { modRecordFromResolved } from "./mod-sync.ts";

export interface LiveAuthoredPolicy {
  get authored(): Authored;
  get policy(): import("../schema/policy.ts").ResolvedPolicy;
  setAuthoredPolicy(authored: Authored, policy: import("../schema/policy.ts").ResolvedPolicy): void;
  configHash(): string;
}

export function createLiveAuthoredPolicy(initialAuthored: Authored, initialPolicy: import("../schema/policy.ts").ResolvedPolicy): LiveAuthoredPolicy {
  let authored = initialAuthored;
  let policy = initialPolicy;
  return {
    get authored() {
      return authored;
    },
    get policy() {
      return policy;
    },
    setAuthoredPolicy(a, p) {
      authored = a;
      policy = p;
    },
    configHash() {
      return authored.hash;
    },
  };
}

export async function seedAuthoredStatFingerprint(readStorage: StoragePort, authored: Authored, baseStorage: StoragePort): Promise<void> {
  (authored as Authored & { _statFp?: string })._statFp = await statFingerprint(readStorage, authored.files, baseStorage);
}

async function statFingerprint(readStorage: StoragePort, files: Record<string, string>, baseStorage: StoragePort): Promise<string> {
  const keys = Object.keys(files).sort();
  const parts: string[] = [];
  for (const path of keys) {
    const st = await readStorage.stat(path);
    parts.push(`${path}:${st?.mtimeMs ?? 0}:${st?.size ?? 0}`);
  }
  for (const path of await baseStorage.listFiles("mods")) {
    const st = await baseStorage.stat(path);
    parts.push(`mods:${path}:${st?.mtimeMs ?? 0}:${st?.size ?? 0}`);
  }
  return sha256Hex(parts.join("\n"));
}

export async function checkHotReload(
  k: Kernel,
  live: LiveAuthoredPolicy,
  presets: PresetRegistry,
  opts?: { replayConfigHash?: string; knownRuleFns?: Set<string>; modCtx?: EngineModContext },
): Promise<{ reloaded: boolean; warnings: string[]; errors: string[]; modCtx?: EngineModContext }> {
  const replayConfigHash = opts?.replayConfigHash;
  const knownRuleFns = opts?.knownRuleFns ?? new Set<string>();
  const warnings: string[] = [];
  const errors: string[] = [];
  const prev = live.authored;
  let modCtx = opts?.modCtx;
  if (!modCtx) {
    return { reloaded: false, warnings, errors, modCtx };
  }
  modCtx = await refreshEngineModContext(k.storage, modCtx);
  const fp = await statFingerprint(modCtx.readStorage, prev.files, k.storage);
  const cachedFp = (prev as Authored & { _statFp?: string })._statFp;
  if (cachedFp === fp) return { reloaded: false, warnings, errors, modCtx };

  try {
    const nextAuthored = await loadAuthored(modCtx.readStorage, {
      presets,
      resolvedMods: modCtx.overlay.ordered,
      modProvenance: modCtx.overlay.provenance,
      liftDisplayStrings: true,
    });
    (nextAuthored as Authored & { _statFp?: string })._statFp = await statFingerprint(
      modCtx.readStorage,
      nextAuthored.files,
      k.storage,
    );
    if (nextAuthored.hash === prev.hash) return { reloaded: false, warnings, errors, modCtx };

    const loaded = await loadPolicy(modCtx.readStorage, nextAuthored.config, presets, {
      knownRuleFns,
      authoredFields: Object.fromEntries(
        Object.entries(nextAuthored.fields).map(([id, f]) => [id, { level: f.level }]),
      ),
    });
    live.setAuthoredPolicy(nextAuthored, loaded.policy);
    await k.emit([
      {
        kind: "config.reloaded",
        hash: nextAuthored.hash,
        previous: prev.hash,
        mods: modRecordFromResolved(modCtx.overlay.ordered),
      },
    ]);
    if (replayConfigHash && replayConfigHash !== nextAuthored.hash) {
      const msg = `Replay config hash ${replayConfigHash} differs from loaded ${nextAuthored.hash}`;
      warnings.push(msg);
      await k.emit([{ kind: "config.warning", code: "replay_config", message: msg }]);
    }
    return { reloaded: true, warnings, errors, modCtx };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(msg);
    await k.emit([{ kind: "config.error", message: msg }]);
    return { reloaded: false, warnings, errors, modCtx };
  }
}
