/**
 * The engine repository stands alone: it builds, type-checks, and tests with nothing but its own files.
 *
 * Nothing may reach outside the repository root: not an import, not a path built from `import.meta.dir`, not a
 * workspace or tsconfig entry, not an absolute path. Markdown links are covered by the documentation hygiene test.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const ROOT = resolve(import.meta.dir, "../../../..");

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".turbo", "coverage", "__pycache__"]);
const isThirdParty = (relPath: string): boolean => /(^|\/)(\.venv[^/]*|vendor)(\/|$)/.test(relPath);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const relPath = relative(ROOT, full).split(sep).join("/");
    if (isThirdParty(relPath)) continue;
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = walk(ROOT);
const rel = (f: string): string => relative(ROOT, f).split(sep).join("/");
const inside = (abs: string): boolean => abs === ROOT || abs.startsWith(ROOT + sep);
const sourceFiles = files.filter((f) => /\.(ts|tsx|js|mjs)$/.test(f));

describe("engine repository is self-contained", () => {
  test("relative imports stay inside the repository and resolve", () => {
    const bad: string[] = [];
    // Static imports/re-exports at the start of a line (so code held in string literals is not mistaken for an import),
    // side-effect imports, and dynamic `import()` / `require()` calls.
    const specs = [
      /^[ \t]*(?:import|export)\b[^;"'`]*?\bfrom\s*["'](\.{1,2}\/[^"']*)["']/gm,
      /^[ \t]*import\s*["'](\.{1,2}\/[^"']*)["']/gm,
      /\b(?:import|require)\(\s*["'](\.{1,2}\/[^"']*)["']\s*\)/g,
    ];
    const exists = (abs: string): boolean =>
      [abs, `${abs}.ts`, `${abs}.tsx`, `${abs}.js`, `${abs}.json`, join(abs, "index.ts")].some((p) => existsSync(p));
    // Build output (`dist/`) exists only after `bun run build`; the smoke scripts that import it must stay inside the repository.
    const isBuildOutput = (abs: string): boolean => relative(ROOT, abs).split(sep).includes("dist");
    for (const f of sourceFiles) {
      const text = readFileSync(f, "utf8");
      for (const spec of specs) {
        for (const m of text.matchAll(spec)) {
          const abs = resolve(dirname(f), m[1]!);
          if (!inside(abs)) bad.push(`${rel(f)}: ${m[1]} leaves the repository`);
          else if (!isBuildOutput(abs) && !exists(abs)) bad.push(`${rel(f)}: ${m[1]} does not resolve`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  test("paths built from the module directory stay inside the repository", () => {
    const bad: string[] = [];
    const joined = /(?:import\.meta\.(?:dir|dirname)|__dirname)\s*,\s*((?:["'][^"']*["']\s*,?\s*)+)\)/g;
    for (const f of files.filter((p) => /\.(ts|tsx|js|mjs)$/.test(p))) {
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(joined)) {
        const parts = [...m[1]!.matchAll(/["']([^"']*)["']/g)].map((x) => x[1]!);
        const abs = resolve(dirname(f), ...parts);
        if (!inside(abs)) bad.push(`${rel(f)}: ${parts.join("/")} leaves the repository`);
      }
    }
    expect(bad).toEqual([]);
  });

  test("no absolute home or workspace paths in any text file", () => {
    const hits: string[] = [];
    const abs = /(?:^|[\s"'`(=])(?:\/Users\/|\/home\/[a-z]|[A-Z]:\\Users\\)/;
    for (const f of files) {
      if (!/\.(md|ts|tsx|js|mjs|json|yaml|yml|py|sh|txt|toml)$/.test(f) || f.endsWith("bun.lock")) continue;
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((l, i) => {
          if (abs.test(l)) hits.push(`${rel(f)}:${i + 1}`);
        });
    }
    expect(hits).toEqual([]);
  });

  test("package manifests and tsconfig files reference only the repository", () => {
    const bad: string[] = [];
    for (const f of files) {
      const name = f.slice(f.lastIndexOf(sep) + 1);
      if (name === "package.json") {
        const pkg = JSON.parse(readFileSync(f, "utf8")) as Record<string, unknown>;
        const check = (what: string, value: string): void => {
          const m = value.match(/^(?:file|link|portal):(.*)$/);
          const target = m ? m[1]! : /^\.{1,2}\//.test(value) ? value : undefined;
          if (target && !inside(resolve(dirname(f), target))) bad.push(`${rel(f)}: ${what} -> ${value}`);
        };
        for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const) {
          for (const [dep, range] of Object.entries((pkg[field] ?? {}) as Record<string, string>)) check(`${field}.${dep}`, range);
        }
        const ws = pkg.workspaces;
        const patterns = Array.isArray(ws) ? ws : ((ws as { packages?: string[] } | undefined)?.packages ?? []);
        for (const p of patterns) check("workspaces", String(p).startsWith(".") ? String(p) : `./${p}`);
      } else if (/^tsconfig.*\.json$/.test(name)) {
        const text = readFileSync(f, "utf8");
        for (const m of text.matchAll(/"(?:extends|path)"\s*:\s*"([^"]+)"/g)) {
          const target = m[1]!;
          if (/^\.{1,2}\//.test(target) && !inside(resolve(dirname(f), target))) bad.push(`${rel(f)}: ${target}`);
        }
        for (const m of text.matchAll(/"(?:include|exclude|files)"\s*:\s*\[([^\]]*)\]/g)) {
          for (const entry of m[1]!.matchAll(/"([^"]+)"/g)) {
            const target = entry[1]!;
            if (target.startsWith("..") && !inside(resolve(dirname(f), target))) bad.push(`${rel(f)}: ${target}`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  test("the repository has its own workspace root and lockfile", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { workspaces?: string[] };
    expect(pkg.workspaces).toEqual(["packages/*"]);
    expect(existsSync(join(ROOT, "bun.lock"))).toBe(true);
    expect(existsSync(join(ROOT, "tsconfig.base.json"))).toBe(true);
  });
});
