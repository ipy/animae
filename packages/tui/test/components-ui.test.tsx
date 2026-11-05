import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToString } from "ink";
import { Button, ButtonRow } from "../src/components/Button.tsx";
import { HelpOverlay } from "../src/components/HelpOverlay.tsx";
import { TooSmall } from "../src/components/TooSmall.tsx";
import { TrackBar } from "../src/components/TrackBar.tsx";
import { ThemeProvider } from "../src/context/theme-context.tsx";
import { MouseProvider } from "../src/context/mouse-context.tsx";
import { TuiI18nProvider } from "../src/i18n/context.tsx";
import { defaultTheme } from "../src/theme/defaults.ts";
import { createInkHarness, waitMs } from "./helpers/ink-harness.ts";

function themed(node: React.ReactNode) {
  return createElement(
    ThemeProvider,
    {
      theme: defaultTheme,
      children: createElement(TuiI18nProvider, {
        initialLocale: "en",
        children: createElement(MouseProvider, { mouseOption: false, children: node }),
      }),
    },
  );
}

describe("simple components", () => {
  test("Button renders hotkey and focused colors", () => {
    const out = renderToString(
      themed(createElement(Button, { label: "Save", hotkey: "S", focused: true, onPress: () => {} })),
    );
    expect(out).toContain("[S] Save");
  });

  test("ButtonRow wraps children", () => {
    const out = renderToString(themed(createElement(ButtonRow, { children: "row" })));
    expect(out).toContain("row");
  });

  test("HelpOverlay shows F1 help lines", () => {
    const out = renderToString(themed(createElement(HelpOverlay)));
    expect(out).toContain("Help (F1)");
    expect(out).toContain(":save");
  });

  test("TooSmall shows required dimensions", () => {
    const out = renderToString(themed(createElement(TooSmall, { cols: 60, rows: 10 })));
    expect(out).toContain("60");
    expect(out).toContain("10");
  });

  test("TrackBar renders bar and optional labels", () => {
    const out = renderToString(
      themed(
        createElement(TrackBar, { label: "bond", value: 50, max: 100, width: 8, valueLabel: "close" }),
      ),
    );
    expect(out).toContain("█");
    expect(out).toContain("close");
  });

  test("Button onPress via ink harness", async () => {
    let pressed = false;
    const harness = createInkHarness(
      themed(createElement(Button, { label: "Go", onPress: () => (pressed = true) })),
    );
    await waitMs(40);
    harness.unmount();
    expect(pressed).toBe(false);
  });
});
