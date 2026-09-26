import { parseFrontmatter, stringifyYaml } from "../store/util.ts";

const HTML_COMMENT = /<!--[\s\S]*?-->/g;
const MOD_STUB_COMMENT = /LLM body:\s*mods\//i;

/** Remove HTML comments (including mod placeholder comments). */
export function stripHtmlComments(text: string): string {
  return text.replace(HTML_COMMENT, "").trim();
}

/** True when markdown body is empty, only whitespace, `{}`, or mod stub comments. */
export function isNonPromptBody(body: string): boolean {
  const stripped = stripHtmlComments(body).trim();
  if (!stripped || stripped === "{}") return true;
  if (MOD_STUB_COMMENT.test(body) && stripped.replace(/\{\}/g, "").trim().length === 0) return true;
  return false;
}

/** Body text safe to embed in LLM prompts (no frontmatter fences, no stub comments). */
export function cleanMarkdownBodyForPrompt(raw: string): string {
  const { body } = parseFrontmatter(raw);
  const cleaned = stripHtmlComments(body).trim();
  if (isNonPromptBody(cleaned)) return "";
  return cleaned;
}

/** Merge card.append.md: substantive overlay replaces stub tail; comment-only appends are skipped. */
export function mergeMarkdownAppend(base: string, append: string): string {
  const appendBody = cleanMarkdownBodyForPrompt(append);
  if (!appendBody) return base;
  const { data, body } = parseFrontmatter(base);
  const baseBody = stripHtmlComments(body).trim();
  if (isNonPromptBody(baseBody)) {
    const fm = data && Object.keys(data).length ? `---\n${JSON.stringify(data)}\n---\n` : "";
    return `${fm}${appendBody}\n`;
  }
  const stubTail = /\n---\n\{\}\n---\n[\s\S]*$/;
  const withoutStub = baseBody.replace(stubTail, "").trimEnd();
  const merged = withoutStub ? `${withoutStub}\n\n${appendBody}` : appendBody;
  const fmLine = data && Object.keys(data).length ? `---\n${stringifyYaml(data).trimEnd()}\n---\n` : "";
  return `${fmLine}${merged}\n`;
}
