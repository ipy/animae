import { expect, test } from "bun:test";
import { readFile, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const refRoot = join(dirname(fileURLToPath(import.meta.url)), "../ref-client");

test("index.html references existing assets", async () => {
  const html = await readFile(join(refRoot, "index.html"), "utf8");
  const hrefs = [...html.matchAll(/(?:href|src)="(\.\/[^"]+)"/g)].map((m) => m[1]!);
  expect(hrefs.length).toBeGreaterThan(0);
  for (const rel of hrefs) {
    const path = join(refRoot, rel.replace(/^\.\//, ""));
    const s = await stat(path);
    expect(s.isFile()).toBe(true);
  }
});
