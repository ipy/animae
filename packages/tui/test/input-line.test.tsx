import { test, expect } from "bun:test";
import { createElement } from "react";
import { renderToString } from "ink";
import { InputLine } from "../src/components/InputLine.tsx";
import { ThemeProvider } from "../src/context/theme-context.tsx";
import { defaultTheme } from "../src/theme/defaults.ts";

test("InputLine renders UTF-8 text with active cursor", () => {
  const out = renderToString(
    createElement(ThemeProvider, {
      theme: defaultTheme,
      children: createElement(InputLine, {
        width: 40,
        value: "caféabc",
        cursor: 3,
        active: true,
      }),
    }),
  );
  expect(out).toContain("café");
  expect(out).toContain(">");
});
