import { expect, test } from "bun:test";
import { buildTestKernel, minimalAuthored } from "../helpers/fake-kernel.ts";
import {
  formatTemplateValue,
  renderTemplate,
  renderTemplateDeep,
  templateExpressions,
} from "../../src/rule-backend/template.ts";

function kernelWithWarnings() {
  const k = buildTestKernel(minimalAuthored());
  const warnings: { code: string; message: string; detail?: unknown }[] = [];
  Object.assign(k, {
    warn: (code: string, message: string, detail?: unknown) => {
      warnings.push({ code, message, detail });
    },
  });
  return { k, warnings };
}

test("formatTemplateValue shows each value kind the way a template reads", () => {
  expect(formatTemplateValue(null)).toBe("");
  expect(formatTemplateValue(undefined)).toBe("");
  expect(formatTemplateValue("plain")).toBe("plain");
  expect(formatTemplateValue(3)).toBe("3");
  expect(formatTemplateValue(2.456)).toBe("2.46");
  expect(formatTemplateValue(true)).toBe("true");
  expect(formatTemplateValue(10n)).toBe("10");
  expect(formatTemplateValue([1, "a", 2.5, [true]])).toBe("1, a, 2.5, true");
  expect(formatTemplateValue({ a: 1 })).toBe('{"a":1}');
});

test("renderTemplate fills CEL placeholders and keeps string-table references for the display layer", () => {
  const { k, warnings } = kernelWithWarnings();
  const vars = { who: "Mira", n: 2, tags: ["a", "b"] };
  expect(renderTemplate(k, "{{ who }} has {{ size(tags) }} tags and {{ n * 2.0 }} coins", vars)).toBe(
    "Mira has 2 tags and 4 coins",
  );
  // `{{name:id}}` and `{{t.key}}` are resolved by the string-table layer, never evaluated as CEL.
  expect(renderTemplate(k, "{{ name:npc1 }} / {{t.greeting}} / {{ who }}", vars)).toBe(
    "{{ name:npc1 }} / {{t.greeting}} / Mira",
  );
  expect(warnings).toEqual([]);
});

test("a placeholder that fails to evaluate renders empty text and is reported, the rest still renders", () => {
  const { k, warnings } = kernelWithWarnings();
  expect(renderTemplate(k, "before {{ missing_var.deep }} after {{ who }}", { who: "Mira" })).toBe("before  after Mira");
  expect(warnings).toHaveLength(1);
  expect(warnings[0]!.code).toBe("RULE_TEMPLATE_ERROR");
  expect(warnings[0]!.detail).toEqual({ expr: "missing_var.deep" });
});

test("renderTemplate resolves display keys through the kernel's display text when it has one", () => {
  const { k } = kernelWithWarnings();
  const seen: { locale: string; text: string; localizeNames: boolean | undefined }[] = [];
  Object.assign(k, {
    displayText: {
      resolve: (locale: string, text: string, o?: { localizeNames?: boolean }) => {
        seen.push({ locale, text, localizeNames: o?.localizeNames });
        return text.replace("$t:hello", "Hello, {{ who }}");
      },
    },
  });
  expect(renderTemplate(k, "$t:hello!", { who: "Mira" })).toBe("Hello, Mira!");
  expect(renderTemplate(k, "$t:hello!", { who: "Mira" }, { locale: "fr" })).toBe("Hello, Mira!");
  expect(seen).toEqual([
    { locale: "en", text: "$t:hello!", localizeNames: false },
    { locale: "fr", text: "$t:hello!", localizeNames: false },
  ]);
});

test("renderTemplateDeep walks objects and arrays and passes other values through", () => {
  const { k } = kernelWithWarnings();
  const out = renderTemplateDeep(
    k,
    { title: "{{ who }}", list: ["{{ n }}", 7, null, { nested: "x{{ who }}" }], flag: true },
    { who: "Mira", n: 5 },
  );
  expect(out).toEqual({ title: "Mira", list: ["5", 7, null, { nested: "xMira" }], flag: true });
  expect(renderTemplateDeep(k, 42, {})).toBe(42);
  expect(renderTemplateDeep(k, null, {})).toBeNull();
});

test("templateExpressions lists the CEL expressions and skips string-table references", () => {
  expect(templateExpressions("plain")).toEqual([]);
  expect(templateExpressions("{{ a }} and {{b + 1}} then {{ name:npc }} {{t.key}} {{ size(x) }}")).toEqual([
    "a",
    "b + 1",
    "size(x)",
  ]);
});
