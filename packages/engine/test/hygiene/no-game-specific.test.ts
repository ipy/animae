import { test, expect } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const ANIMae_ROOT = join(import.meta.dir, "../../../..");

const DENY = [
  /\blilium\b/i,
  /\bnsfw\b/i,
  /\bkink\b/i,
  /\bsubmission\b/i,
  /\bzombie\b/i,
  /\b顾远\b/,
  /\bgalgame\b/i,
  /\bharem\b/i,
  /后宫/,
  /\badult\b/i,
  /\bbai-zhi\b/i,
  /\bcen-wu\b/i,
  /\bxie-lingjun\b/i,
  /\bjiang-hansheng\b/i,
  /\bwen-yin\b/i,
  /\bluo-qi\b/i,
  /\bsong-huaijin\b/i,
  /\bsu-jin\b/i,
  /\bshen-rong\b/i,
  /\bmother-yuan\b/i,
  /\bzhou-lingyi\b/i,
  /\bgreenhouse-hall\b/i,
  /games\/lilium/i,
];

const ALLOW: { file: RegExp; pattern: RegExp }[] = [
  // hygiene test lists deny terms intentionally
  { file: /no-game-specific\.test\.ts$/, pattern: /.*/ },
];

const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(ent.name)) continue;
    const p = join(dir, ent.name);
    if (ent.isDirectory()) await walk(p, out);
    else out.push(p);
  }
  return out;
}

function allowed(file: string, pattern: RegExp): boolean {
  return ALLOW.some((a) => a.file.test(file) && a.pattern.test(pattern.source));
}

test("animae tree has no game-specific terms", async () => {
  const files = await walk(ANIMae_ROOT);
  const hits: string[] = [];
  for (const file of files) {
    if (!/\.(ts|tsx|md|yaml|yml|json|txt|js|mjs|cjs)$/.test(file)) continue;
    const text = await readFile(file, "utf8");
    for (const pattern of DENY) {
      if (!pattern.test(text)) continue;
      if (allowed(file, pattern)) continue;
      hits.push(`${file.replace(ANIMae_ROOT + "/", "")}: ${pattern.source}`);
    }
  }
  expect(hits).toEqual([]);
});
