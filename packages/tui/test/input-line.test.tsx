import { test, expect } from "bun:test";
import { createElement } from "react";
import { renderToString } from "ink";
import { InputLine } from "../src/components/InputLine.tsx";
import { ThemeProvider } from "../src/context/theme-context.tsx";
import { defaultTheme } from "../src/theme/defaults.ts";

test("InputLine renders CJK with active cursor", () => {
  const out = renderToString(
    createElement(ThemeProvider, {
      theme: defaultTheme,
      children: createElement(InputLine, {
        width: 40,
        value: "你好abc",
        cursor: 2,
        active: true,
      }),
    }),
  );
  expect(out).toContain("你好");
  expect(out).toContain(">");
});
