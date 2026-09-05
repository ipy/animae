import type { Kernel } from "../contracts.ts";
import { memoryCacheFor } from "../memory/service.ts";

/** After timeline branch/load/rewind operations, drop derived module caches. */
export function rebuildModuleCaches(k: Kernel): void {
  const owners = Object.keys(k.timeline.state().characters);
  for (const owner of owners) {
    const list = memoryCacheFor(k, owner);
    void list;
  }
  // Memory service uses WeakMap keyed by kernel; caches are branch-keyed and refreshed on read.
}
