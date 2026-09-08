/** CJK and fullwidth punctuation in string literals (not comments). */
const CJK_IN_STRING =
  /(["'`])(?:(?:\\.|(?!\1)[\s\S])*?[\u3000-\u9fff\uff00-\uffef](?:\\.|(?!\1)[\s\S])*?)\1/g;

const ALLOWLIST_PATH_RE =
  /(?:^|\/)(?:locales|prompts)\/|display-width\.|tier-display\.|dev-session\.|cjk-|fuzzy-match\.|segment-utils\.|prompt\.ts$|\/generated\.ts$|i18n\/test\//;

export function findCjkStringLiterals(source: string, filePath: string): { line: number; excerpt: string }[] {
  if (ALLOWLIST_PATH_RE.test(filePath.replace(/\\/g, "/"))) return [];
  const hits: { line: number; excerpt: string }[] = [];
  let m: RegExpExecArray | null;
  CJK_IN_STRING.lastIndex = 0;
  while ((m = CJK_IN_STRING.exec(source))) {
    const idx = m.index;
    const line = source.slice(0, idx).split("\n").length;
    const excerpt = m[0]!.length > 80 ? `${m[0]!.slice(0, 77)}…` : m[0]!;
    hits.push({ line, excerpt });
  }
  return hits;
}
