import { MemoryStorage } from "../../src/store/memory.ts";
import type { StoragePort } from "../../src/ports.ts";

/** In-test storage — same as production `MemoryStorage` (root-level paths supported). */
export function testStorage(root = "test-root"): StoragePort {
  return MemoryStorage(root);
}
