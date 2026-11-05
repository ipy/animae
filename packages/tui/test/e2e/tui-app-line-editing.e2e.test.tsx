import { afterEach, describe, expect, test } from "bun:test";
import { openRuleEngine, startScene, type RuleEngineHandle } from "../../../engine/test/helpers/rule-fixture.ts";
import { KEYS, mountLiveTui } from "../helpers/live-app-harness.tsx";
import { endedTurns, eventually, submitted } from "../helpers/engine-e2e.ts";
import { waitMs } from "../helpers/ink-harness.ts";
import { playTypedLine } from "../helpers/tui-play.ts";

const BACKSPACE = "\x7f";
const DELETE = "\x1b[3~";
const LEFT = "\x1b[D";
const RIGHT = "\x1b[C";

describe("TuiApp input line and choice menu on the rule engine (e2e)", () => {
  let handle: RuleEngineHandle | undefined;
  let tui: ReturnType<typeof mountLiveTui> | undefined;

  afterEach(async () => {
    tui?.unmount();
    tui = undefined;
    if (handle) await handle.dispose();
    handle = undefined;
  });

  async function boot() {
    handle = await openRuleEngine();
    const sceneId = await startScene(handle.engine);
    tui = mountLiveTui({ engine: handle.engine, scene: { sceneId }, mouse: false }, { columns: 120, rows: 40 });
    await waitMs(80);
  }

  test("the arrow keys, Backspace and Delete edit the line before Enter submits it", async () => {
    await boot();
    await tui!.type("helo wrld");
    await tui!.press(...Array<string>(6).fill(LEFT)); // after "hel"
    await tui!.type("l"); // "hello wrld"
    await tui!.press(RIGHT, RIGHT, RIGHT); // after the "w"
    await tui!.type("o"); // "hello world"
    await tui!.press(RIGHT, RIGHT, RIGHT); // the end of the line
    await tui!.type("!!");
    await tui!.press(BACKSPACE); // "hello world!"
    await tui!.press(LEFT, DELETE); // the "!" goes
    await tui!.press(KEYS.enter);
    expect(await eventually(async () => (await endedTurns(handle!.engine)) === 1)).toBe(true);
    expect(await submitted(handle!.engine)).toEqual(["hello world"]);
    await tui!.finish(60);
  });

  test("the cursor stops at both ends of the line", async () => {
    await boot();
    await tui!.type("ab");
    await tui!.press(...Array<string>(4).fill(LEFT)); // more steps than there are characters
    await tui!.type("x"); // at the start: "xab"
    await tui!.press(...Array<string>(6).fill(RIGHT));
    await tui!.type("y"); // at the end: "xaby"
    await tui!.press(DELETE, BACKSPACE, BACKSPACE, BACKSPACE, BACKSPACE, BACKSPACE); // nothing after the cursor; empties the line
    await tui!.type("z");
    await tui!.press(KEYS.enter);
    expect(await eventually(async () => (await endedTurns(handle!.engine)) === 1)).toBe(true);
    expect(await submitted(handle!.engine)).toEqual(["z"]);
    await tui!.finish(60);
  });

  test("the up and down arrows bring back the lines already sent", async () => {
    await boot();
    await playTypedLine(tui!, handle!.engine, "first line", 1);
    await playTypedLine(tui!, handle!.engine, "second line", 2);
    await tui!.press(KEYS.up, KEYS.up); // newest first, then the one before
    await tui!.press(KEYS.down, KEYS.up); // forth and back again: "first line"
    await tui!.press(KEYS.enter);
    expect(await eventually(async () => (await endedTurns(handle!.engine)) === 3)).toBe(true);
    expect(await submitted(handle!.engine)).toEqual(["first line", "second line", "first line"]);
    await tui!.finish(60);
  });

  test("history steps that arrive in the same tick all count", async () => {
    await boot();
    await playTypedLine(tui!, handle!.engine, "first line", 1);
    await playTypedLine(tui!, handle!.engine, "second line", 2);
    await tui!.burst(KEYS.up, KEYS.up); // two steps back from the empty line
    await tui!.press(KEYS.enter);
    expect(await eventually(async () => (await endedTurns(handle!.engine)) === 3)).toBe(true);
    expect(await submitted(handle!.engine)).toEqual(["first line", "second line", "first line"]);
    await tui!.finish(60);
  });

  test("the arrow keys move through the choice menu and stop at its ends, and Enter picks the highlighted choice", async () => {
    await boot();
    await tui!.type("hello");
    await tui!.press(KEYS.enter);
    expect(await eventually(async () => (await endedTurns(handle!.engine)) === 1)).toBe(true);
    expect(await tui!.pollUntil((t) => t.includes("▸ 1. Thank her."), 4000)).toBe(true);
    await tui!.press(KEYS.up); // already on the first choice
    expect(tui!.getText()).toContain("▸ 1. Thank her.");
    await tui!.press(KEYS.down, KEYS.down, KEYS.down); // more steps than there are choices
    expect(tui!.getText()).toContain("▸ 2. Ask about the rain.");
    await tui!.press(KEYS.up);
    expect(tui!.getText()).toContain("▸ 1. Thank her.");
    await tui!.press(KEYS.down, KEYS.enter);
    expect(await eventually(async () => (await submitted(handle!.engine)).at(-1) === "choice:c2")).toBe(true);
    await tui!.finish(60);
  });

  test("Tab completes a colon command, and a slash on an empty line opens the palette", async () => {
    await boot();
    await tui!.type(":sav");
    await tui!.press(KEYS.tab);
    await tui!.press(KEYS.enter);
    expect(await eventually(async () => (await handle!.engine.timeline.saves()).length === 1)).toBe(true);

    await tui!.press("/");
    expect(await tui!.pollUntil((t) => t.includes("Command palette"), 2000)).toBe(true);
    await tui!.press(KEYS.escape);
    expect(await tui!.pollUntil((t) => !t.includes("Command palette"), 2000)).toBe(true);
    await tui!.finish(60);
  });
});
