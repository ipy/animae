import type { Kernel } from "../contracts.ts";
import type { CelContext } from "../types.ts";

/** `{{ expr }}` placeholders; `{{name:id}}` and `{{t.key}}` belong to the string-table layer, not to CEL. */
const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g;
const STRING_TABLE_REF = /^(?:name\s*:|t\.)/;

/** Text of a CEL value the way a template shows it: strings as-is, whole numbers without `.0`, lists comma-joined. */
export function formatTemplateValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
  if (typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (Array.isArray(value)) return value.map(formatTemplateValue).join(", ");
  return JSON.stringify(value);
}

export interface TemplateOptions {
  /** locale of `$t:` keys and `{{name:id}}` references; default: the engine's output locale */
  locale?: string;
}

/**
 * Renders one template string of the rule backend: resolves `$t:key` / `{{name:id}}` through the engine's string tables,
 * then replaces every `{{ CEL }}` placeholder with the formatted value of the expression evaluated against `vars`.
 * A placeholder that fails to evaluate renders as empty text and is reported through `k.warn` (a template typo must
 * not take a rule-mode game down).
 */
export function renderTemplate(k: Kernel, template: string, vars: CelContext, opts: TemplateOptions = {}): string {
  const locale = opts.locale ?? k.i18n.outputLocale;
  let text = template;
  if (k.displayText) {
    const resolved = k.displayText.resolve(locale, template, { localizeNames: false });
    if (typeof resolved === "string") text = resolved;
  }
  return text.replace(PLACEHOLDER, (whole, expr: string) => {
    if (STRING_TABLE_REF.test(expr)) return whole;
    try {
      return formatTemplateValue(k.rules.cel.eval(expr, vars));
    } catch (e) {
      k.warn("RULE_TEMPLATE_ERROR", e instanceof Error ? e.message : String(e), { expr });
      return "";
    }
  });
}

/** Renders every string inside `value` (objects and arrays are walked); other values pass through. */
export function renderTemplateDeep<T>(k: Kernel, value: T, vars: CelContext, opts: TemplateOptions = {}): T {
  if (typeof value === "string") return renderTemplate(k, value, vars, opts) as T;
  if (Array.isArray(value)) return value.map((v) => renderTemplateDeep(k, v, vars, opts)) as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) out[key] = renderTemplateDeep(k, v, vars, opts);
    return out as T;
  }
  return value;
}

/** Every `{{ CEL }}` expression a template contains (for validation); string-table references are skipped. */
export function templateExpressions(template: string): string[] {
  const out: string[] = [];
  for (const m of template.matchAll(PLACEHOLDER)) {
    const expr = m[1]!;
    if (!STRING_TABLE_REF.test(expr)) out.push(expr);
  }
  return out;
}
