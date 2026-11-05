import { afterEach, describe, expect, test } from "bun:test";
import {
  openRuleEngine,
  startScene,
  type RuleEngineHandle,
} from "../../../engine/test/helpers/rule-fixture.ts";
import { KEYS, mountLiveTui } from "../helpers/live-app-harness.tsx";
import { endedTurns, eventually, submitted, THANKS_REPLY } from "../helpers/engine-e2e.ts";
import { waitMs } from "../helpers/ink-harness.ts";

const PAGE_UP = "\x1b[5~";

describe("TuiApp live flows (e2e)", () => {
  let handle: RuleEngineHandle | undefined;
  let tui: ReturnType<typeof mountLiveTui> | undefined;

  afterEach(async () => {
    tui?.unmount();
    tui = undefined;
    if (handle) await handle.dispose();
    handle = undefined;
  });

  async function boot(size = { columns: 120, rows: 40 }) {
    handle = await openRuleEngine();
    const sceneId = await startScene(handle.engine);
    tui = mountLiveTui({ engine: handle.engine, scene: { sceneId }, mouse: false }, size);
    await waitMs(80);
  }

  /**
   * Types one line and waits until its turn has ended and the choice menu is up. A rule turn always offers choices
   * and the menu takes the focus, so Tab + Escape hand it back to the input line before the next free-text line.
   */
  async function playLine(line: string, turnNumber: number): Promise<void> {
    await tui!.type(line);
    await tui!.press(KEYS.enter);
    expect(await eventually(async () => (await endedTurns(handle!.engine)) === turnNumber)).toBe(true);
    expect(await tui!.pollUntil((t) => t.includes("Thank her."), 4000)).toBe(true);
    await tui!.press(KEYS.tab, KEYS.escape);
    expect(await tui!.pollUntil((t) => !t.includes("Thank her."), 2000)).toBe(true);
  }

  test("three typed turns reach the engine in order and stay in the transcript", async () => {
    await boot();
    const lines = ["ping zero", "ping one", "ping two"];
    for (const [i, line] of lines.entries()) await playLine(line, i + 1);

    expect(await submitted(handle!.engine)).toEqual(lines);
    const screen = tui!.getText();
    for (const line of lines) expect(screen).toContain(line);
    // One speaker label per turn for the player and for Aria (her reply text is picked at random).
    expect(screen.match(/^player:/gm)).toHaveLength(3);
    expect(screen.match(/^npc1:/gm)).toHaveLength(3);
    await tui!.finish(60);
  });

  test("Page Up shows the oldest turn, Page Down returns to the latest one", async () => {
    await boot({ columns: 100, rows: 24 });
    const lines = ["scroll-a", "scroll-b", "scroll-c"];
    for (const [i, line] of lines.entries()) await playLine(line, i + 1);
    expect(tui!.getText()).toContain("scroll-c");
    expect(tui!.getText()).not.toContain("Jump to latest");

    await tui!.press(PAGE_UP);
    expect(await tui!.pollUntil((t) => t.includes("Jump to latest"), 2000)).toBe(true);
    expect(tui!.getText()).toContain("scroll-a");
    expect(tui!.getText()).not.toContain("scroll-c");

    await tui!.press(KEYS.pageDown);
    expect(await tui!.pollUntil((t) => t.includes("scroll-c") && !t.includes("Jump to latest"), 2000)).toBe(true);
    await tui!.finish(60);
  });

  test("choice via digit key after a thank-you turn", async () => {
    await boot();
    await tui!.type("thank you");
    await tui!.press(KEYS.enter);
    expect(await tui!.pollUntil((t) => t.includes("Thank her."), 4000)).toBe(true);
    expect(await tui!.pollUntil((t) => THANKS_REPLY.test(t), 2000)).toBe(true);
    await tui!.press("1");
    expect(await eventually(async () => (await submitted(handle!.engine)).length === 2)).toBe(true);
    expect(await submitted(handle!.engine)).toEqual(["thank you", "choice:c1"]);
    expect(await eventually(async () => (await endedTurns(handle!.engine)) === 2)).toBe(true);
    await tui!.finish(80);
  });
});
