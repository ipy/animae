import { describe, expect, test } from "bun:test";
import { assertPromptLintClean, lintAssembledPrompt } from "../../src/pipeline/prompt-lint.ts";

describe("lintAssembledPrompt edge rules", () => {
  test("flags frontmatter, blank runs, empty headings, unresolved vars", () => {
    const text = "---\ntitle: x\n---\n\n\n\n# \n\nHello {name}.";
    const codes = lintAssembledPrompt(text).map((i) => i.code);
    expect(codes).toContain("FRONTMATTER");
    expect(codes).toContain("BLANK_RUN");
    expect(codes).toContain("EMPTY_HEADING");
    expect(codes).toContain("UNRESOLVED_VAR");
  });

  test("flags i18n key leak and punctuation clash", () => {
    expect(lintAssembledPrompt("see location.tavern.name here").some((i) => i.code === "I18N_KEY_LEAK")).toBe(true);
    expect(lintAssembledPrompt("End。\；").some((i) => i.code === "PUNCT_CLASH")).toBe(true);
  });

  test("flags immediately repeated paragraph with index", () => {
    const issues = lintAssembledPrompt("Same block.\n\nSame block.\n\nOther.");
    const rep = issues.find((i) => i.code === "REPEATED_PARAGRAPH");
    expect(rep?.index).toBe(1);
  });

  test("assertPromptLintClean throws aggregated codes", () => {
    expect(() => assertPromptLintClean("$t:bad\n<!-- x -->")).toThrow(/UNRESOLVED_STRING_REF/);
  });
});
