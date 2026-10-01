import { expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const refRoot = join(dirname(fileURLToPath(import.meta.url)), "../ref-client");

test("ref-client index.html has no inline style attributes", async () => {
  const html = await readFile(join(refRoot, "index.html"), "utf8");
  expect(html).not.toMatch(/\sstyle="/i);
});

test("ref-client js does not inject static inline styles", async () => {
  const jsDir = join(refRoot, "js");
  const files = (await readdir(jsDir)).filter((f) => f.endsWith(".js"));
  for (const file of files) {
    const src = await readFile(join(jsDir, file), "utf8");
    expect(src, file).not.toMatch(/setAttribute\s*\(\s*["']style["']/);
    expect(src, file).not.toMatch(/\.style\.cssText\s*=/);
  }
});
