import { expect, test } from "bun:test";
import { createTranslator, localizeDeep } from "@animae/i18n";
import { liftStringRefs } from "../../src/i18n/string-resolve.ts";

test("UI locale localizes display refs without mutating stored timeline shape", () => {
  const lifted = liftStringRefs({
    achievement: { title: "$t:error.test_title" },
    event: { kind: "game.test", payload: { label: "$t:error.test_label" } },
  }) as Record<string, unknown>;

  const timelineBlob = JSON.stringify(lifted);

  const en = createTranslator({
    locale: "en",
    catalogs: { strings: { en: { "error.test_title": "First step", "error.test_label": "Hello" } } },
    defaultNamespace: "strings",
  });
  const zh = createTranslator({
    locale: "zh-CN",
    catalogs: { strings: { "zh-CN": { "error.test_title": "第一步", "error.test_label": "你好" } } },
    defaultNamespace: "strings",
  });

  const enView = localizeDeep(lifted, en.t.bind(en));
  const zhView = localizeDeep(lifted, zh.t.bind(zh));

  expect((enView as { achievement: { title: string } }).achievement.title).toBe("First step");
  expect((zhView as { achievement: { title: string } }).achievement.title).toBe("第一步");
  expect(JSON.stringify(lifted)).toBe(timelineBlob);
});
