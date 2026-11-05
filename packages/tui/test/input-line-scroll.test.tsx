import { test, expect } from "bun:test";
import { createElement } from "react";
import { renderToString } from "ink";
import { InputLine } from "../src/components/InputLine.tsx";
import { ThemeProvider } from "../src/context/theme-context.tsx";
import { TuiI18nProvider } from "../src/i18n/context.tsx";
import { defaultTheme } from "../src/theme/defaults.ts";

test("InputLine scrolls wide draft when cursor moves past viewport", () => {
  const long = "abcdefghijklmnopqrstuvwxyz0123456789";
  const out = renderToString(
    createElement(
      ThemeProvider,
      {
        theme: defaultTheme,
        children: createElement(TuiI18nProvider, {
          initialLocale: "en",
          children: createElement(InputLine, {
            width: 20,
            value: long,
            cursor: long.length,
            active: true,
          }),
        }),
      },
    ),
  );
  expect(out).toContain(">");
  expect(out.length).toBeGreaterThan(5);
});

test("InputLine inactive shows tab hint", () => {
  const out = renderToString(
    createElement(
      ThemeProvider,
      {
        theme: defaultTheme,
        children: createElement(TuiI18nProvider, {
          initialLocale: "en",
          children: createElement(InputLine, {
            width: 40,
            value: "x",
            cursor: 1,
            active: false,
          }),
        }),
      },
    ),
  );
  expect(out).toMatch(/tab|focus/i);
});
