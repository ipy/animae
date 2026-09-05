import type { ModConfigRecord } from "../events.ts";
import type { ResolvedMod } from "../mod.ts";
import { modDrift } from "../mods/resolve.ts";
import type { Kernel } from "../contracts.ts";

export function modRecordFromResolved(mods: ResolvedMod[]): ModConfigRecord[] {
  return mods.map((m) => ({ id: m.id, version: m.version, contentHash: m.contentHash }));
}

export async function syncModTimelineRecord(
  kernel: Kernel,
  current: ResolvedMod[],
  recorded: { id: string; version: string; contentHash: string }[] | undefined,
): Promise<void> {
  const { drift, message } = modDrift(recorded, current);
  if (drift) {
    await kernel.emit([
      {
        kind: "config.warning",
        code: "mod_drift",
        message: message ?? "enabled mods differ from timeline record",
      },
    ]);
  }
}

export async function emitInitialModConfig(
  kernel: Kernel,
  hash: string,
  mods: ResolvedMod[],
  stateMods: { id: string; version: string; contentHash: string }[] | undefined,
): Promise<void> {
  const record = modRecordFromResolved(mods);
  const { drift } = modDrift(stateMods, mods);
  if (drift || !stateMods?.length) {
    await kernel.emit([{ kind: "config.reloaded", hash, mods: record }]);
  }
}
