import type { SgrMouseEvent } from "../../src/input/mouse-sgr.ts";

export function testSgrMouse(overrides: Partial<SgrMouseEvent> = {}): SgrMouseEvent {
  return {
    kind: "motion",
    button: "unknown",
    col: 0,
    row: 0,
    shift: false,
    alt: false,
    ctrl: false,
    rawButton: 0,
    ...overrides,
  };
}
