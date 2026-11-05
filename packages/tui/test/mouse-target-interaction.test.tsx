import { describe, expect, test } from "bun:test";
import { Box, Text } from "ink";
import { useEffect, useRef } from "react";
import { MouseProvider, useMouseContext, useMouseTarget } from "../src/context/mouse-context.tsx";
import { ThemeProvider } from "../src/context/theme-context.tsx";
import { defaultTheme } from "../src/theme/defaults.ts";
import { createInkHarness, flushInkFrame } from "./helpers/ink-harness.ts";
import { testSgrMouse } from "./helpers/sgr-mouse-test.ts";
import { PassThrough } from "node:stream";

function ClickTarget() {
  const ref = useRef<import("ink").DOMElement>(null);
  useMouseTarget("t1", ref, {
    hint: "hint-here",
    onEvent: () => {},
  });
  return (
    <Box ref={ref} width={8} height={2}>
      <Text>target</Text>
    </Box>
  );
}

function MotionAfterMount() {
  const { dispatchMouse } = useMouseContext();
  useEffect(() => {
    dispatchMouse(testSgrMouse({ kind: "motion", col: 2, row: 2, button: "unknown" }));
  }, [dispatchMouse]);
  return <Text>probe</Text>;
}

describe("mouse target registration", () => {
  test("dispatchMouse runs when mouse enabled on TTY stdout", async () => {
    const stdout = Object.assign(new PassThrough(), { isTTY: true, columns: 40, rows: 12 });
    const frame = await flushInkFrame(
      createInkHarness(
        <ThemeProvider theme={defaultTheme}>
          <MouseProvider mouseOption={true} stdout={stdout}>
            <ClickTarget />
            <MotionAfterMount />
          </MouseProvider>
        </ThemeProvider>,
      ),
      120,
    );
    expect(frame).toContain("probe");
    expect(frame).toContain("target");
  });

  test("shift+motion does not invoke target onEvent", async () => {
    const stdout = Object.assign(new PassThrough(), { isTTY: true, columns: 40, rows: 12 });
    let events = 0;
    function Counter() {
      const ref = useRef<import("ink").DOMElement>(null);
      const { dispatchMouse } = useMouseContext();
      useMouseTarget("c", ref, {
        onEvent: () => {
          events += 1;
        },
      });
      useEffect(() => {
        dispatchMouse(testSgrMouse({ kind: "motion", col: 1, row: 1, shift: true, button: "unknown" }));
      }, [dispatchMouse]);
      return (
        <Box ref={ref} width={4} height={2}>
          <Text>x</Text>
        </Box>
      );
    }
    await flushInkFrame(
      createInkHarness(
        <ThemeProvider theme={defaultTheme}>
          <MouseProvider mouseOption={true} stdout={stdout}>
            <Counter />
          </MouseProvider>
        </ThemeProvider>,
      ),
      100,
    );
    expect(events).toBe(0);
  });
});
