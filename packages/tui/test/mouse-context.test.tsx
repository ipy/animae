import { describe, expect, test } from "bun:test";
import { Text } from "ink";
import { useEffect, useState } from "react";
import { MouseProvider, useMouseContext } from "../src/context/mouse-context.tsx";
import { ThemeProvider } from "../src/context/theme-context.tsx";
import { defaultTheme } from "../src/theme/defaults.ts";
import { createInkHarness, flushInkFrame } from "./helpers/ink-harness.ts";
import { testSgrMouse } from "./helpers/sgr-mouse-test.ts";
import { PassThrough } from "node:stream";

function MouseProbe() {
  const { enabled, dispatchMouse } = useMouseContext();
  const [motionSeen, setMotionSeen] = useState(false);
  useEffect(() => {
    dispatchMouse(testSgrMouse({ col: 1, row: 1 }));
    setMotionSeen(true);
  }, [dispatchMouse]);
  return (
    <Text>
      {enabled ? "on" : "off"} {motionSeen ? "motion" : "pending"}
    </Text>
  );
}

describe("MouseProvider", () => {
  test("enables mouse and handles motion dispatch", async () => {
    const stdout = Object.assign(new PassThrough(), { isTTY: true, columns: 80, rows: 24 });
    const harness = createInkHarness(
      <ThemeProvider theme={defaultTheme}>
        <MouseProvider mouseOption={true} stdout={stdout}>
          <MouseProbe />
        </MouseProvider>
      </ThemeProvider>,
    );
    const frame = await flushInkFrame(harness, 60);
    expect(frame).toContain("on");
    expect(frame).toContain("motion");
  });

  test("userEnabled=false keeps mouse off", async () => {
    const stdout = Object.assign(new PassThrough(), { isTTY: true, columns: 80, rows: 24 });
    const harness = createInkHarness(
      <ThemeProvider theme={defaultTheme}>
        <MouseProvider mouseOption={true} stdout={stdout} userEnabled={false}>
          <Text>capture-off</Text>
        </MouseProvider>
      </ThemeProvider>,
    );
    expect(await flushInkFrame(harness, 30)).toContain("capture-off");
  });
});
