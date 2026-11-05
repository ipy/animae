import { describe, expect, test } from "bun:test";
import { Box, Text } from "ink";
import { useRef } from "react";
import { measureRefRect, useElementRect } from "../src/hooks/use-element-rect.ts";
import { createInkHarness, flushInkFrame } from "./helpers/ink-harness.ts";

function RectProbe() {
  const ref = useRef<import("ink").DOMElement>(null);
  const rect = useElementRect(ref, [1]);
  return (
    <Box ref={ref} width={6} height={2}>
      <Text>
        {rect.hasMeasured ? `${rect.width}x${rect.height}` : "pending"}
      </Text>
    </Box>
  );
}

describe("useElementRect", () => {
  test("measures ink node after layout", async () => {
    const frame = await flushInkFrame(createInkHarness(<RectProbe />), 80);
    expect(frame).toMatch(/\d+x\d+/);
  });

  test("measureRefRect returns empty when ref unset", () => {
    const ref = { current: null };
    const r = measureRefRect(ref);
    expect(r.hasMeasured).toBe(false);
    expect(r.width).toBe(0);
  });
});
