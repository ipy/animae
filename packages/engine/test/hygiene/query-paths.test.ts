/**
 * `Engine.query(viewer, path)` understands slash paths only. Any other spelling (`world.vars`, `world.location`) is not
 * an error, it answers `undefined`, which is indistinguishable from "denied": a host reading state through one gets an
 * empty panel instead of a failure. Every literal path in the framework's own packages must start with a root the
 * introspection service knows.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const PACKAGES = join(import.meta.dir, "../../..");

/** Roots handled by `introspect/query.ts`. */
const ROOTS = new Set(["world", "characters", "scene", "director", "budget", "ledger", "events", "timeline", "policy", "state"]);

const QUERY_CALL = /\.query(?:Async)?\(\s*[^,()]+,\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === "test") continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".generated.ts")) out.push(full);
  }
  return out;
}

export function badQueryPaths(source: string): string[] {
  const bad: string[] = [];
  for (const m of source.matchAll(QUERY_CALL)) {
    const literal = m[2]!;
    const staticHead = literal.split("${")[0]!;
    const root = staticHead.split("/")[0]!;
    if (!ROOTS.has(root)) bad.push(literal);
  }
  return bad;
}

describe("engine query paths", () => {
  test("the checker flags dotted and unknown roots and accepts real paths", () => {
    expect(badQueryPaths('engine.query(viewer, "world.vars")')).toEqual(["world.vars"]);
    expect(badQueryPaths('engine.query("debug", "authored.world.player")')).toEqual(["authored.world.player"]);
    expect(badQueryPaths('this.engine.query(this.viewer, "world.location")')).toEqual(["world.location"]);
    expect(badQueryPaths("engine.query(viewer, `characters.${id}.tracks`)")).toEqual(["characters.${id}.tracks"]);
    expect(badQueryPaths('engine.query(viewer, "world/vars/res.food")')).toEqual([]);
    expect(badQueryPaths("engine.query(viewer, `characters/${id}/identity`)")).toEqual([]);
    expect(badQueryPaths('engine.query("player", "scene")')).toEqual([]);
  });

  test("no package queries a path the engine does not know", () => {
    const offenders: string[] = [];
    for (const pkg of readdirSync(PACKAGES)) {
      const src = join(PACKAGES, pkg, "src");
      try {
        if (!statSync(src).isDirectory()) continue;
      } catch {
        continue;
      }
      for (const file of sourceFiles(src)) {
        for (const path of badQueryPaths(readFileSync(file, "utf8"))) offenders.push(`${file.slice(PACKAGES.length + 1)}: ${path}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
