import type { StoragePort } from "../ports.ts";
import type { BranchRef } from "../types.ts";
import { readEventsFile } from "./event-log.ts";

export async function rebuildChainFromHeaders(deps: { storage: StoragePort }, current: string): Promise<BranchRef[]> {
  const dirs = await deps.storage.list("timelines");
  const headers: { branch: string; parent?: string; forkAt?: string }[] = [];
  for (const d of dirs) {
    if (!d.endsWith("/")) continue;
    const name = d.slice(0, -1);
    try {
      const { header } = await readEventsFile(deps.storage, name);
      headers.push(header);
    } catch {
      /* skip */
    }
  }
  const byName = new Map(headers.map((h) => [h.branch, h]));
  const chain: BranchRef[] = [];
  let name: string | undefined = current;
  while (name) {
    const h = byName.get(name);
    chain.unshift({ name, parent: h?.parent, forkAt: h?.forkAt });
    name = h?.parent;
  }
  return chain.length ? chain : [{ name: current }];
}
