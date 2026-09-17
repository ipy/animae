import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { test, expect } from "bun:test";

const SRC = join(import.meta.dir, "../../src");

/** Path-like / protocol labels allowed as literal UI (not player copy). */
const ALLOWLIST_SUBSTRINGS = [
  "scene",
  "director/beat",
  "director/anchors",
  "Ctrl+",
  "Alt+",
  "F1",
  "F2",
  "F3",
  "F4",
  "F5",
  "Shift+",
  ":save",
  ":load",
  ":rewind",
  ":help",
  ":quit",
  ":lang",
  ":mouse",
  "…",
  "—",
  "▸",
  "▾",
  "◦",
  "·",
  "player",
  "npm",
  "utf8",
  "json",
  "yaml",
  "ink",
  "react",
  "xterm",
  "NO_MOUSE",
  "TUI_",
  "Simulated",
  "scroll line",
  "QA:",
  "command.desc.",
  "trigger-error",
  "Actor text:",
  "render",
  "appraise",
  "Promise",
];

const SKIP_FILES = new Set([
  "cues/registry.ts",
  "theme/defaults.ts",
  "keymap/default.ts",
  "input/mouse-sgr.ts",
  "ink/vendor/input-parser.js",
]);

const JSX_TEXT = />\s*([A-Za-z(\[][A-Za-z0-9 ,.'()[\]/·—–-]{2,})\s*</g;
const STRING_PROPS =
  /\b(title|hint|placeholder|label|description)\s*=\s*["']([A-Za-z(\[][^"']{2,})["']/g;
const NOTIFY_LITERAL = /\bnotify\s*\(\s*["']([A-Za-z(\[][^"']{2,})["']/g;
const SYSTEM_LINE = /type:\s*["']systemLine["']\s*,\s*text:\s*["']([A-Za-z(\[][^"']{2,})["']/g;
// `{" (Esc to close)"}`-style expression literals inside JSX.
const JSX_EXPRESSION_LITERAL = /\{\s*["'`]\s*([A-Za-z(\[][^"'`{}]{2,}?)["'`]\s*\}/g;

/** Bare key names are labels; a sentence that merely mentions one is player copy and must be translated. */
const KEY_NAME = /^(?:Esc|Enter|Tab|PgUp|PgDn|F\d{1,2})$/;

function allowed(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 3) return true;
  if (KEY_NAME.test(trimmed)) return true;
  if (/^[\d\s:./\\_-]+$/.test(trimmed)) return true;
  if (/^:[a-z]+/.test(trimmed)) return true;
  return ALLOWLIST_SUBSTRINGS.some((a) => trimmed.includes(a));
}

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) await walk(p, out);
    else if (/\.(ts|tsx)$/.test(ent.name)) out.push(p);
  }
  return out;
}

function scanFile(rel: string, text: string): string[] {
  if (SKIP_FILES.has(rel)) return [];
  const hits: string[] = [];
  const run = (re: RegExp, kind: string) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      // The literal is always the last capture group (`STRING_PROPS` captures the prop name first).
      const snippet = m[m.length - 1]!;
      if (!allowed(snippet)) hits.push(`${kind}: ${snippet}`);
    }
  };
  if (rel.endsWith(".tsx")) {
    run(JSX_TEXT, "jsx");
    run(JSX_EXPRESSION_LITERAL, "jsx-expression");
  }
  run(STRING_PROPS, "prop");
  run(NOTIFY_LITERAL, "notify");
  run(SYSTEM_LINE, "systemLine");
  return hits;
}

test("TUI src has no hard-coded English UI literals", async () => {
  const files = await walk(SRC);
  const violations: string[] = [];
  for (const file of files) {
    const rel = relative(join(SRC, ".."), file);
    const short = relative(SRC, file);
    const text = await readFile(file, "utf8");
    if (text.includes("useTuiI18n") || text.includes('t("') || text.includes("t('")) {
      /* expected */
    }
    for (const hit of scanFile(short, text)) {
      violations.push(`${rel}: ${hit}`);
    }
  }
  expect(violations).toEqual([]);
});
