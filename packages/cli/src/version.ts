import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FALLBACK_VERSION = "1.0.0";

/** Version from this package's `package.json`; `readText` is injectable for tests. */
export function readPackageVersion(readText: (path: string) => string = (path) => readFileSync(path, "utf8")): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(here, "..", "package.json");
    const raw = JSON.parse(readText(pkgPath)) as { version?: string };
    return raw.version ?? FALLBACK_VERSION;
  } catch {
    return FALLBACK_VERSION;
  }
}
