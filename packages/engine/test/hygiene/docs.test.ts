/**
 * Documentation hygiene for the engine repository.
 *
 * - English is the only documentation language of this repository. Text in other scripts (CJK, ...) may only appear
 *   inside fenced code blocks / inline code, where it is sample data. Translations of the documentation are published by
 *   the projects that embed the engine, not here.
 * - Specification sections are cited with links, never with the section-sign character.
 * - Nothing in this repository points outside of it: relative links must stay inside the repository root and resolve
 *   to an existing file, and `#anchor` fragments must match a heading of the target document.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const ROOT = resolve(import.meta.dir, "../../../..");

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".turbo", "coverage"]);
/** Python virtualenvs used by the PTY test tooling are third-party code. */
const isSkippedDir = (name: string): boolean => SKIP_DIRS.has(name) || name.startsWith(".venv");
const SECTION_SIGN = String.fromCodePoint(0x00a7);
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

function walk(dir: string, accept: (name: string) => boolean, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (isSkippedDir(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, accept, out);
    else if (accept(name)) out.push(full);
  }
  return out;
}

const markdownFiles = walk(ROOT, (n) => n.endsWith(".md"));
const textFiles = walk(ROOT, (n) => /\.(md|ts|tsx|json|yaml|yml|py|txt)$/.test(n) && n !== "bun.lock");

const rel = (f: string): string => relative(ROOT, f).split(sep).join("/");

/** Remove fenced code blocks (``` or ~~~) and inline code spans, keeping line structure. */
function stripCode(text: string): string {
  const out: string[] = [];
  let fence: string | undefined;
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      if (m && m[1]!.startsWith(fence[0]!) && m[1]!.length >= fence.length) fence = undefined;
      out.push("");
      continue;
    }
    if (m) {
      fence = m[1]!;
      out.push("");
      continue;
    }
    out.push(line.replace(/`[^`\n]*`/g, ""));
  }
  return out.join("\n");
}

/** Inline code and ordinary text stay; fenced blocks go. Used for headings and link scanning. */
function stripFences(text: string): string {
  const out: string[] = [];
  let fence: string | undefined;
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      if (m && m[1]!.startsWith(fence[0]!) && m[1]!.length >= fence.length) fence = undefined;
      out.push("");
      continue;
    }
    if (m) {
      fence = m[1]!;
      out.push("");
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

/** GitHub heading slug (github-slugger behaviour for the characters that occur in these docs). */
export function slugify(heading: string): string {
  const plain = heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[`*~]/g, "")
    .trim();
  return plain
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replace(/ /g, "-");
}

const anchorCache = new Map<string, Set<string>>();

function anchorsOf(file: string): Set<string> {
  const cached = anchorCache.get(file);
  if (cached) return cached;
  const anchors = new Set<string>();
  const seen = new Map<string, number>();
  for (const line of stripFences(readFileSync(file, "utf8")).split("\n")) {
    const m = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (!m) continue;
    const base = slugify(m[2]!);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    anchors.add(n === 0 ? base : `${base}-${n}`);
  }
  // Explicit HTML anchors (`<a id="x"></a>` / `<a name="x">`).
  for (const m of readFileSync(file, "utf8").matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) anchors.add(m[1]!);
  anchorCache.set(file, anchors);
  return anchors;
}

type Link = { file: string; line: number; target: string };

function linksOf(file: string): Link[] {
  const out: Link[] = [];
  const body = stripCode(readFileSync(file, "utf8")).split("\n");
  body.forEach((line, i) => {
    for (const m of line.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
      out.push({ file, line: i + 1, target: m[1]! });
    }
    const def = line.match(/^\s{0,3}\[[^\]]+\]:\s*<?(\S+?)>?(?:\s+.*)?$/);
    if (def) out.push({ file, line: i + 1, target: def[1]! });
  });
  return out;
}

describe("engine documentation hygiene", () => {
  test("repository has documentation to check", () => {
    expect(markdownFiles.length).toBeGreaterThan(20);
    expect(existsSync(join(ROOT, "docs/spec.md"))).toBe(true);
  });

  test("no section-sign citations in docs, code, tests or data", () => {
    const hits: string[] = [];
    for (const f of textFiles) {
      const lines = readFileSync(f, "utf8").split("\n");
      lines.forEach((l, i) => {
        if (l.includes(SECTION_SIGN)) hits.push(`${rel(f)}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });

  test("English only: no non-Latin prose, CJK only in code samples", () => {
    const hits: string[] = [];
    for (const f of markdownFiles) {
      stripCode(readFileSync(f, "utf8"))
        .split("\n")
        .forEach((l, i) => {
          if (CJK.test(l)) hits.push(`${rel(f)}:${i + 1}`);
        });
    }
    expect(hits).toEqual([]);
  });

  test("the repository ships no translated editions of its documents", () => {
    const translated = markdownFiles.filter((f) => /\.[a-z]{2,3}(?:-[A-Za-z0-9]+)*\.md$/.test(f.slice(f.lastIndexOf(sep) + 1)));
    expect(translated.map(rel)).toEqual([]);
  });

  test("the specification has numbered top-level sections", () => {
    const sections = stripFences(readFileSync(join(ROOT, "docs/spec.md"), "utf8"))
      .split("\n")
      .filter((l) => /^##\s+\d+\./.test(l));
    expect(sections.length).toBeGreaterThan(15);
  });

  test("relative links stay inside the repository and resolve to files", () => {
    const bad: string[] = [];
    for (const f of markdownFiles) {
      for (const l of linksOf(f)) {
        if (/^[a-z][a-z0-9+.-]*:/i.test(l.target) || l.target.startsWith("#")) continue;
        const [pathPart] = l.target.split("#");
        const abs = resolve(dirname(f), decodeURIComponent(pathPart!));
        const inside = abs === ROOT || abs.startsWith(ROOT + sep);
        if (!inside) bad.push(`${rel(f)}:${l.line} escapes the repository: ${l.target}`);
        else if (!existsSync(abs)) bad.push(`${rel(f)}:${l.line} broken link: ${l.target}`);
      }
    }
    expect(bad).toEqual([]);
  });

  test("#anchor fragments match a heading of the target document", () => {
    const bad: string[] = [];
    for (const f of markdownFiles) {
      for (const l of linksOf(f)) {
        if (/^[a-z][a-z0-9+.-]*:/i.test(l.target)) continue;
        const hash = l.target.indexOf("#");
        if (hash < 0) continue;
        const fragment = decodeURIComponent(l.target.slice(hash + 1));
        if (!fragment) continue;
        const pathPart = l.target.slice(0, hash);
        const abs = pathPart ? resolve(dirname(f), decodeURIComponent(pathPart)) : f;
        if (!abs.endsWith(".md") || !existsSync(abs)) continue;
        if (!anchorsOf(abs).has(fragment.toLowerCase())) bad.push(`${rel(f)}:${l.line} missing anchor: ${l.target}`);
      }
    }
    expect(bad).toEqual([]);
  });

  test("docs name repository files relative to the repository root", () => {
    // `animae/docs/...` only exists in a parent workspace that mounts this repository as a directory called `animae`.
    const prefixed = /(^|[\s"'`(=])animae\/(?:docs|packages|dist|scripts)\b/;
    const hits: string[] = [];
    for (const f of markdownFiles) {
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((l, i) => {
          if (prefixed.test(l)) hits.push(`${rel(f)}:${i + 1}`);
        });
    }
    expect(hits).toEqual([]);
  });

  test("repository paths named in the docs exist", () => {
    // Illustrative paths of a package a reader would create; they are not part of this repository.
    const illustrative = [/^packages\/locale-fr\//, /^packages\/my-preset\/?$/];
    // Build output (`packages/cli/dist/...`) exists only after `bun run build`, which a fresh clone has not run yet.
    const buildOutput = /(^|\/)dist(\/|$)/;
    const packageDirs = readdirSync(join(ROOT, "packages")).map((n) => join(ROOT, "packages", n));
    const token = /(?<![\w/.-])((?:docs|packages|scripts)\/[A-Za-z0-9_@./-]*[A-Za-z0-9_])/g;
    const missing: string[] = [];
    for (const f of markdownFiles) {
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((l, i) => {
          for (const m of l.matchAll(token)) {
            const path = m[1]!;
            if (illustrative.some((re) => re.test(path)) || buildOutput.test(path)) continue;
            // a bare `scripts/...` in a package's own doc is relative to that package
            const candidates = [join(ROOT, path), join(dirname(f), path), ...packageDirs.map((d) => join(d, path))];
            if (!candidates.some((c) => existsSync(c))) missing.push(`${rel(f)}:${i + 1} ${path}`);
          }
        });
    }
    expect(missing).toEqual([]);
  });

  test("docs never mention files outside the engine repository", () => {
    const deny: { re: RegExp; why: string }[] = [
      { re: /(^|[\s`(\[])games\/[<\w{]/, why: "games/ directory" },
      { re: /\/Users\//, why: "absolute home path" },
      { re: /(^|[\s`(\[])(?:\.\.\/){3,}/, why: "relative path leaving the repository" },
    ];
    const hits: string[] = [];
    for (const f of markdownFiles) {
      const text = stripFences(readFileSync(f, "utf8"));
      text.split("\n").forEach((l, i) => {
        for (const d of deny) if (d.re.test(l)) hits.push(`${rel(f)}:${i + 1} (${d.why})`);
      });
    }
    expect(hits).toEqual([]);
  });
});
