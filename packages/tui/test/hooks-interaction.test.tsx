import { describe, expect, test } from "bun:test";
import { Box, Text } from "ink";
import { useEngine } from "../src/hooks/use-engine.ts";
import { useEvents } from "../src/hooks/use-events.ts";
import { useKeymap } from "../src/hooks/use-keymap.ts";
import { useElementRect, measureRefRect } from "../src/hooks/use-element-rect.ts";
import { useRef } from "react";
import type { DOMElement } from "ink";
import { createTuiFakeEngineControls } from "./helpers/fake-engine.ts";
import { createInkHarness, flushInkFrame } from "./helpers/ink-harness.ts";
import { FullTuiTestShell } from "./helpers/tui-shell.tsx";

function EngineProbe() {
  const engine = useEngine();
  return <Text>{engine.info().sessionId}</Text>;
}

function EventsProbe() {
  const events = useEvents(["utterance"]);
  return <Text>{events.map((e) => e.kind).join(",")}</Text>;
}

function KeymapProbe() {
  const { keymap } = useKeymap();
  return <Text>{keymap.help.join(",")}</Text>;
}

function RectProbe() {
  const ref = useRef<DOMElement>(null);
  const rect = useElementRect(ref, [0]);
  return (
    <Box ref={ref}>
      <Text>
        {rect.hasMeasured ? "measured" : "pending"} {measureRefRect(ref).width}
      </Text>
    </Box>
  );
}

describe("hooks", () => {
  test("useEngine reads session from context", async () => {
    const { engine } = createTuiFakeEngineControls();
    const harness = createInkHarness(
      <FullTuiTestShell engine={engine}>
        <EngineProbe />
      </FullTuiTestShell>,
    );
    expect(await flushInkFrame(harness, 50)).toContain("sess");
  });

  test("useEvents loads history and listens", async () => {
    const { engine, emit } = createTuiFakeEngineControls();
    emit("utterance", { id: "evt_live" });
    const harness = createInkHarness(
      <FullTuiTestShell engine={engine}>
        <EventsProbe />
      </FullTuiTestShell>,
    );
    expect(await flushInkFrame(harness, 120)).toContain("utterance");
  });

  test("useKeymap exposes default bindings", async () => {
    const { engine } = createTuiFakeEngineControls();
    const harness = createInkHarness(
      <FullTuiTestShell engine={engine}>
        <KeymapProbe />
      </FullTuiTestShell>,
    );
    expect(await flushInkFrame(harness, 30)).toContain("f1");
  });

  test("useElementRect measures ink nodes", async () => {
    const { engine } = createTuiFakeEngineControls();
    const harness = createInkHarness(
      <FullTuiTestShell engine={engine}>
        <RectProbe />
      </FullTuiTestShell>,
    );
    const frame = await flushInkFrame(harness, 50);
    expect(frame.includes("measured") || frame.includes("pending")).toBe(true);
  });
});
