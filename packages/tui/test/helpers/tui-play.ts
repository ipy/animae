import { expect } from "bun:test";
import type { Engine } from "@animae/engine";
import { endedTurns, eventually } from "./engine-e2e.ts";
import { KEYS, type mountLiveTui } from "./live-app-harness.tsx";

/**
 * Plays one typed line on the rule engine's standard scene: types it, presses Enter, waits for the turn to end and for
 * the choice menu ("Thank her."), then leaves the menu so that the focus is back on the input line.
 * `turnNumber` is the number of turns the log holds once this one has ended.
 */
export async function playTypedLine(
  tui: ReturnType<typeof mountLiveTui>,
  engine: Engine,
  line: string,
  turnNumber: number,
): Promise<void> {
  await tui.type(line);
  await tui.press(KEYS.enter);
  expect(await eventually(async () => (await endedTurns(engine)) === turnNumber)).toBe(true);
  expect(await tui.pollUntil((t) => t.includes("Thank her."), 4000)).toBe(true);
  await tui.press(KEYS.tab, KEYS.escape);
  expect(await tui.pollUntil((t) => !t.includes("Thank her."), 2000)).toBe(true);
}
