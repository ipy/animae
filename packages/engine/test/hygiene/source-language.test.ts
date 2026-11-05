/**
 * The engine repository is English-native and locale-neutral:
 *
 * - runtime packages ship English resources only; other languages arrive as locale packs from the embedding project;
 * - source files hold no string literals in non-Latin scripts (those belong to catalogs and locale packs);
 * - no file or path names one specific translation (a regional language tag, or a language named by script variant).
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { findCjkStringLiterals } from "@animae/i18n";

const ROOT = resolve(import.meta.dir, "../../../..");

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".turbo", "coverage", "__pycache__"]);
/** Third-party code vendored for the PTY test tooling (Python virtualenvs, the `wcwidth` package). */
const isThirdParty = (relPath: string): boolean => /(^|\/)(\.venv[^/]*|vendor)(\/|$)/.test(relPath);

/** Runtime packages: they must not ship a locale other than English. */
const RUNTIME_PACKAGES = ["engine", "cli", "tui", "host", "web", "i18n"];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const rel = relative(ROOT, full).split(sep).join("/");
    if (isThirdParty(rel)) continue;
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = walk(ROOT);
const rel = (f: string): string => relative(ROOT, f).split(sep).join("/");
const isTest = (f: string): boolean => /(^|\/)test\//.test(rel(f)) || /\.test\.tsx?$/.test(f);
const isText = (f: string): boolean =>
  /\.(md|ts|tsx|js|mjs|json|yaml|yml|py|sh|txt|toml|html|css)$/.test(f) && !f.endsWith("bun.lock");
const NON_LATIN_CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/**
 * A language code with a region or script subtag of one specific translation, or a language named by script variant.
 * The character classes keep this file from matching its own pattern.
 */
const NAMED_TRANSLATION = /\b[z]h(?:[-_](?:CN|TW|HK|SG|MO|Hans|Hant))?\b|\b(?:Simplified|Traditional) [C]hinese\b/i;
const NAMED_IN_PATH = /(^|[/._-])[z]h([-_][A-Za-z]+)?([/._-]|$)/i;

describe("engine source language hygiene", () => {
  test("runtime packages ship English locale resources only", () => {
    const extra: string[] = [];
    for (const pkg of RUNTIME_PACKAGES) {
      const dir = join(ROOT, "packages", pkg, "locales");
      let tags: string[] = [];
      try {
        tags = readdirSync(dir).filter((n) => statSync(join(dir, n)).isDirectory());
      } catch {
        continue;
      }
      for (const tag of tags) if (tag !== "en") extra.push(`packages/${pkg}/locales/${tag}`);
    }
    expect(extra).toEqual([]);
  });

  test("the prompt bundles of the engine are English only", () => {
    const dir = join(ROOT, "packages/engine/src/prompts");
    const tags = readdirSync(dir).filter((n) => statSync(join(dir, n)).isDirectory());
    expect(tags).toEqual(["en"]);
  });

  test(
    "TypeScript sources hold no string literals in non-Latin scripts",
    () => {
      const hits: string[] = [];
      for (const f of files) {
        if (!/\.(ts|tsx|js|mjs)$/.test(f) || isTest(f)) continue;
        for (const h of findCjkStringLiterals(readFileSync(f, "utf8"), f)) hits.push(`${rel(f)}:${h.line} ${h.excerpt}`);
      }
      expect(hits).toEqual([]);
    },
    { timeout: 60_000 },
  );

  test(
    "source, data, and tooling files hold no CJK characters outside tests",
    () => {
      const hits: string[] = [];
      for (const f of files) {
        if (!isText(f) || isTest(f) || f.endsWith(".md")) continue;
        readFileSync(f, "utf8")
          .split("\n")
          .forEach((l, i) => {
            if (NON_LATIN_CJK.test(l)) hits.push(`${rel(f)}:${i + 1}`);
          });
      }
      expect(hits).toEqual([]);
    },
    { timeout: 60_000 },
  );

  test("no file names a specific translation", () => {
    const hits: string[] = [];
    for (const f of files) {
      if (!isText(f)) continue;
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((l, i) => {
          if (NAMED_TRANSLATION.test(l)) hits.push(`${rel(f)}:${i + 1}`);
        });
    }
    expect(hits).toEqual([]);
  });

  test("file and directory names do not name a specific translation", () => {
    const bad = files.map(rel).filter((p) => NAMED_IN_PATH.test(p));
    expect(bad).toEqual([]);
  });
});
