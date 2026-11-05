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
  const fr = createTranslator({
    locale: "fr",
    catalogs: { strings: { fr: { "error.test_title": "Premiere etape", "error.test_label": "Bonjour" } } },
    defaultNamespace: "strings",
  });

  const enView = localizeDeep(lifted, en.t.bind(en));
  const frView = localizeDeep(lifted, fr.t.bind(fr));

  expect((enView as { achievement: { title: string } }).achievement.title).toBe("First step");
  expect((frView as { achievement: { title: string } }).achievement.title).toBe("Premiere etape");
  expect(JSON.stringify(lifted)).toBe(timelineBlob);
});
