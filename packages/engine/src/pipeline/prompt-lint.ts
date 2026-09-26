const TRUNC_MARKER = "truncated to segment budget";
const FRONTMATTER_FENCE = /^---\n[\s\S]*?\n---\s*$/m;
const I18N_KEY = /\b[a-z][a-z0-9_-]*\.[a-z0-9_.-]+\b/i;
const INTERNAL_ID = /\b(?:scn|evt|turn|dyn|sess)_[a-z0-9]+\b/i;
const RAW_JSON_LINE = /^\s*\w+\.\w+:\s*\{"kind":/m;
const PUNCT_CLASH = /\u3002\uff1b|\uff1b\uff1b/;
const CJK_SPACE = /[\u3000-\u9fff][ \t]{2,}[\u3000-\u9fff]/;

export interface PromptLintIssue {
  code: string;
  message: string;
  index?: number;
}

/** Invariants for assembled model prompts (authored prose should already be cleaned). */
export function lintAssembledPrompt(text: string): PromptLintIssue[] {
  const issues: PromptLintIssue[] = [];
  if (text.includes("$t:")) issues.push({ code: "UNRESOLVED_STRING_REF", message: "contains $t: string ref" });
  if (/\{\{[^}]*\}\}/.test(text)) issues.push({ code: "UNRESOLVED_TEMPLATE", message: "contains {{...}} marker" });
  if (text.includes("<!--")) issues.push({ code: "HTML_COMMENT", message: "contains HTML comment" });
  if (text.includes(TRUNC_MARKER)) issues.push({ code: "TRUNCATION_MARKER", message: "contains truncation marker" });
  if (FRONTMATTER_FENCE.test(text)) issues.push({ code: "FRONTMATTER", message: "contains frontmatter fence block" });
  if (/\n{3,}/.test(text)) issues.push({ code: "BLANK_RUN", message: "contains 2+ consecutive blank lines" });
  if (/^\s*#+\s*$/m.test(text)) issues.push({ code: "EMPTY_HEADING", message: "contains empty heading" });
  if (/(?<!\{)\{[a-zA-Z_][a-zA-Z0-9_]*\}(?!\})/.test(text)) {
    issues.push({ code: "UNRESOLVED_VAR", message: "contains unresolved {var} placeholder" });
  }
  if (I18N_KEY.test(text) && /location\.|character\.|track\.|event\./.test(text)) {
    issues.push({ code: "I18N_KEY_LEAK", message: "contains dotted i18n-style key token" });
  }
  if (INTERNAL_ID.test(text)) issues.push({ code: "INTERNAL_ID", message: "contains internal scn/evt/turn id" });
  if (RAW_JSON_LINE.test(text)) issues.push({ code: "RAW_EVENT_JSON", message: "contains raw JSON event line" });
  if (PUNCT_CLASH.test(text)) issues.push({ code: "PUNCT_CLASH", message: "contains a full stop followed by a semicolon (or doubled semicolons)" });
  if (CJK_SPACE.test(text)) issues.push({ code: "CJK_SPACE", message: "contains space between CJK characters" });
  const paras = text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  for (let i = 1; i < paras.length; i++) {
    if (paras[i] === paras[i - 1]) {
      issues.push({ code: "REPEATED_PARAGRAPH", message: "contains immediately repeated paragraph", index: i });
      break;
    }
  }
  return issues;
}

export function assertPromptLintClean(text: string): void {
  const issues = lintAssembledPrompt(text);
  if (issues.length) {
    throw new Error(`prompt lint: ${issues.map((i) => i.code).join(", ")}`);
  }
}
