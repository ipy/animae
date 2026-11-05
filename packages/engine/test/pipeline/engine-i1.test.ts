import { test, expect, describe } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const PIPELINE_DIR = join(import.meta.dir, "../../src/pipeline");
const GAMEPLAY_MARKERS = [/\u767e\u5408\u56ed/, /\u63a5\u5408/, /\u8c03\u60c5/, /\u5a01\u4fe1/, /\u6e29\u5ba4/];

function listTsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return listTsFiles(p);
    if (e.name.endsWith(".ts")) return [p];
    return [];
  });
}

describe("I1 engine pipeline strings", () => {
  test("pipeline sources contain no host-game-specific gameplay wording", () => {
    const files = listTsFiles(PIPELINE_DIR);
    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const re of GAMEPLAY_MARKERS) {
        if (re.test(text)) hits.push(`${file}: ${re.source}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
