import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createElement, type ReactNode } from "react";
import { Box, Text, renderToString } from "ink";
import { TuiApp } from "../src/app/TuiApp.tsx";
import { Overlay } from "../src/components/Overlay.tsx";
import { Viewport } from "../src/components/Viewport.tsx";
import { createTuiFakeEngine } from "./helpers/fake-engine.ts";
import { stripAnsi } from "./helpers/ink-harness.ts";

/**
 * A terminal frame has a fixed height. These tests render the composed frame (what Ink hands to the terminal)
 * and check that content taller than its region is clipped instead of being painted over its neighbours -
 * the failure mode where two transcript entries shared one row and the day report ran into the input line.
 */

const numbered = (prefix: string, n: number): string[] =>
  Array.from({ length: n }, (_, i) => `${prefix} ${String(i + 1).padStart(2, "0")}`);

const rowsOf = (out: string): string[] => stripAnsi(out).split("\n");

describe("Viewport", () => {
  const frame = (anchor: "start" | "end", height: number): string[] =>
    rowsOf(
      renderToString(
        <Box height={height} flexDirection="column">
          <Viewport anchor={anchor}>
            {/* Entries of 1, 3, 2 and 1 rows. */}
            <Text>a1</Text>
            <Text>{"b1\nb2\nb3"}</Text>
            <Text>{"c1\nc2"}</Text>
            <Text>d1</Text>
          </Viewport>
        </Box>,
        { columns: 20 },
      ),
    ).map((r) => r.trimEnd());

  test("anchor=end keeps the newest rows and clips the oldest", () => {
    expect(frame("end", 4)).toEqual(["b3", "c1", "c2", "d1"]);
  });

  test("anchor=start keeps the first rows and clips the newest", () => {
    expect(frame("start", 4)).toEqual(["a1", "b1", "b2", "b3"]);
  });

  test("content that fits is laid out untouched", () => {
    expect(frame("start", 7)).toEqual(["a1", "b1", "b2", "b3", "c1", "c2", "d1"]);
    expect(frame("end", 9).filter(Boolean)).toEqual(["a1", "b1", "b2", "b3", "c1", "c2", "d1"]);
  });
});

describe("Overlay", () => {
  test("clips a long list at its frame without repeating or merging rows", () => {
    const out = rowsOf(
      renderToString(
        <Overlay title="Log" width={30} height={8}>
          {numbered("entry", 20).map((t) => (
            <Text key={t}>{t}</Text>
          ))}
        </Overlay>,
        { columns: 40 },
      ),
    );
    expect(out.length).toBe(8);
    const body = out.map((r) => r.replace(/[│┌┐└┘─]/g, "").trim()).filter((r) => r.startsWith("entry"));
    expect(body).toEqual(numbered("entry", body.length));
    expect(body.length).toBeGreaterThan(0);
  });

  test("the close hint is localized text, not a literal", () => {
    const out = stripAnsi(
      renderToString(
        <Overlay title="T">
          <Text>x</Text>
        </Overlay>,
        { columns: 40 },
      ),
    );
    expect(out).toContain("T (");
    expect(out).not.toContain("undefined");
  });
});

describe("full layout", () => {
  const stdout = process.stdout as unknown as { columns?: number; rows?: number };
  let saved: { columns?: number; rows?: number };

  beforeEach(() => {
    saved = { columns: stdout.columns, rows: stdout.rows };
    stdout.columns = 120;
    stdout.rows = 40;
  });
  afterEach(() => {
    stdout.columns = saved.columns;
    stdout.rows = saved.rows;
  });

  const bigPanel = {
    id: "big",
    title: "Big panel",
    render: (): ReactNode =>
      createElement(
        Box,
        { flexDirection: "column" },
        ...numbered("panel row", 60).map((t) => createElement(Text, { key: t }, t)),
      ),
  };

  const renderApp = (message: string): string[] =>
    rowsOf(
      renderToString(
        createElement(TuiApp, {
          engine: createTuiFakeEngine(),
          initialMessage: message,
          scene: { sceneId: "scn_0001" },
          panels: [bigPanel],
        } as never),
        { columns: 120 },
      ),
    );

  test("a transcript and a side panel taller than the screen are clipped inside their own regions", () => {
    const frame = renderApp(numbered("report line", 90).join("\n"));
    expect(frame.length).toBe(40);

    const panelCol = frame.findIndex((r) => r.includes("Big panel"));
    expect(panelCol).toBeGreaterThanOrEqual(0);
    const split = frame[panelCol]!.indexOf("Big panel") - 2;
    const left = frame.map((r) => r.slice(0, split).trimEnd());
    const right = frame.map((r) => r.slice(split).trim());

    // Transcript: the newest lines, consecutive and in order, ending at the last one.
    const report = left.filter((r) => r.startsWith("report line"));
    expect(report.length).toBeGreaterThan(10);
    expect(report.at(-1)).toBe("report line 90");
    expect(report).toEqual(numbered("report line", 90).slice(90 - report.length));

    // Side panel: its own first rows, consecutive (nothing painted over them, nothing beyond its region).
    const panel = right.filter((r) => r.startsWith("panel row"));
    expect(panel.length).toBeGreaterThan(5);
    expect(panel).toEqual(numbered("panel row", 60).slice(0, panel.length));

    // The input line and the footer stay below every row of either region.
    const inputRow = left.findLastIndex((r) => r.startsWith(">"));
    expect(inputRow).toBeGreaterThan(left.lastIndexOf(report.at(-1)!));
    expect(right.slice(inputRow).some((r) => r.startsWith("panel row"))).toBe(false);
    expect(frame.slice(inputRow).some((r) => r.includes("report line"))).toBe(false);
  });

  test("a short transcript sits next to the input, not at the top of an empty pane", () => {
    const frame = renderApp("only line");
    const row = frame.findIndex((r) => r.includes("only line"));
    const inputRow = frame.findIndex((r) => r.startsWith(">"));
    expect(row).toBeGreaterThan(0);
    expect(inputRow - row).toBeLessThanOrEqual(2);
  });
});
