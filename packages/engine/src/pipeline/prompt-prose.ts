import type { Kernel } from "../contracts.ts";
import { authoredFieldPlain, type DisplayNameOptions } from "../entities/names.ts";
import { cleanMarkdownBodyForPrompt, stripHtmlComments } from "../prose/for-prompt.ts";
import { promptText } from "./prompt-text.ts";

/**
 * The text of an authored field as it should be resolved for a prompt. Late-bound fields (`{ i18n: { key } }`, lifted
 * from `$t:key` at load time) become `$t:key` again so `promptText` resolves them in the prompt language instead of
 * leaking the bare key.
 */
function authoredFieldRef(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const o = value as { i18n?: { key?: unknown }; $t?: unknown };
    if (typeof o.i18n?.key === "string") return `$t:${o.i18n.key}`;
    if (typeof o.$t === "string") return o.$t.startsWith("$t:") ? o.$t : `$t:${o.$t}`;
  }
  return authoredFieldPlain(value);
}

function collapseSpaceRunsOutsideFences(text: string): string {
  const parts = text.split(/(```[\s\S]*?```)/g);
  return parts
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part
            .replace(/[ \t]{2,}/g, " ")
            .replace(/[^\S\n]+/g, " ")
            .replace(/([\u3000-\u9fff])[^\S\n]+([\u3000-\u9fff])/g, "$1$2"),
    )
    .join("");
}

/** Resolve `$t:` keys, expand `{{name:id}}`, and strip mod stub comments from authored prose. */
export function prepareAuthoredProse(k: Kernel, text: string | undefined | unknown, opts?: DisplayNameOptions): string {
  const plain = authoredFieldRef(text);
  if (!plain.trim()) return "";
  let raw = plain.trim();
  if (raw.startsWith("---")) raw = cleanMarkdownBodyForPrompt(raw);
  else raw = stripHtmlComments(raw).trim();
  if (!raw) return "";
  const resolved = promptText(k, raw, opts)?.trim() ?? "";
  return collapseSpaceRunsOutsideFences(resolved).trim();
}
