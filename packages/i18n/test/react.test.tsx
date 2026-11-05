import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createI18n } from "../src/create-i18n.ts";
import { I18nProvider, useLocale, useT } from "../src/react.tsx";

const catalogs = {
  common: {
    en: { hello: "Hello {name}" },
    fr: { hello: "Salut {name}" },
  },
};

function Probe() {
  const t = useT();
  const [locale] = useLocale();
  return (
    <span data-locale={locale} data-text={t("hello", { name: "X" })} />
  );
}

test("I18nProvider useT reflects locale switches", () => {
  const i18n = createI18n({ locale: "en", catalogs, dev: false });
  const html = renderToStaticMarkup(
    <I18nProvider i18n={i18n}>
      <Probe />
    </I18nProvider>,
  );
  expect(html).toContain('data-locale="en"');
  expect(html).toContain("Hello X");
});

test("@animae/i18n/react browser bundle exports hooks", async () => {
  const out = await Bun.build({
    entrypoints: [import.meta.dir + "/../src/react.tsx"],
    target: "browser",
    minify: true,
  });
  expect(out.success).toBe(true);
  const blob = out.outputs[0];
  expect(blob).toBeDefined();
  const text = await new Response(blob).text();
  expect(text).toContain("useT");
  expect(text).not.toMatch(/node:fs/);
});
