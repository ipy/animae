import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FALLBACK_VERSION = "1.0.0";

export function readPackageVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(here, "..", "package.json");
    const raw = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
    return raw.version ?? FALLBACK_VERSION;
  } catch {
    return FALLBACK_VERSION;
  }
}
