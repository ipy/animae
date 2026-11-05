import { describe, expect, test } from "bun:test";
import { localizeDeep } from "@animae/i18n";
import type { Kernel } from "../../src/contracts.ts";
import { liftStringRefs } from "../../src/i18n/string-resolve.ts";
import { prepareAuthoredProse } from "../../src/pipeline/prompt-prose.ts";
import { charDef, createPipelineKernel } from "./test-kernel.ts";

const TABLES: Record<string, Record<string, string>> = {
  fr: { "location.loc.name": "Greenhouse Hall (fr)", "location.loc.summary": "Summary (fr)" },
  en: { "location.loc.name": "Greenhouse Hall" },
};

const displayText: NonNullable<Kernel["displayText"]> = {
  resolve: (locale, value) => localizeDeep(liftStringRefs(value), (key) => TABLES[locale]?.[key] ?? TABLES.en?.[key] ?? key),
  lookup: (locale, key) => TABLES[locale]?.[key],
  prepare: async () => {},
};

describe("authored prose for prompts", () => {
  const { k } = createPipelineKernel({
    chars: [charDef("npc1"), charDef("player")],
    i18n: { promptLocale: "fr", outputLocale: "en", contentLocale: "fr" },
    displayText,
  });

  test("a late-bound field (lifted from a string key at load time) resolves in the prompt language, never to the bare key", () => {
    expect(prepareAuthoredProse(k, { i18n: { key: "location.loc.name" } })).toBe("Greenhouse Hall (fr)");
    expect(prepareAuthoredProse(k, "$t:location.loc.summary")).toBe("Summary (fr)");
  });

  test("a late-bound field without a table entry is dropped instead of leaking its key", () => {
    expect(prepareAuthoredProse(k, { i18n: { key: "location.missing.name" } })).toBe("");
  });

  test("plain strings pass through, comment-only bodies disappear", () => {
    expect(prepareAuthoredProse(k, "  plain text ")).toBe("plain text");
    expect(prepareAuthoredProse(k, "<!-- placeholder -->")).toBe("");
  });
});

describe("prepareAuthoredProse whitespace", () => {
  test("drops stray spaces between CJK characters but keeps line and paragraph breaks", () => {
    const { k } = createPipelineKernel({ chars: [charDef("mira"), charDef("player")] });
    const out = prepareAuthoredProse(k, "\u7b2c\u4e00\u53e5\u3002\n\n\u7b2c\u4e8c\u6bb5 \u7ee7\u7eed\n\u7b2c\u4e09\u884c\u3002");
    expect(out).toBe("\u7b2c\u4e00\u53e5\u3002\n\n\u7b2c\u4e8c\u6bb5\u7ee7\u7eed\n\u7b2c\u4e09\u884c\u3002");
  });
});
