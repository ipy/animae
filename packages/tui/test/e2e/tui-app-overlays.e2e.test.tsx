import { afterEach, describe, expect, test } from "bun:test";
import {
  openRuleEngine,
  rulePreset,
  startScene,
  type OpenRuleEngineOptions,
  type RuleEngineHandle,
} from "../../../engine/test/helpers/rule-fixture.ts";
import { KEYS, mountLiveTui } from "../helpers/live-app-harness.tsx";
import { assertLogInvariants } from "../../../engine/test/e2e/session-invariants.ts";
import { eventually, submitted } from "../helpers/engine-e2e.ts";
import { playTypedLine } from "../helpers/tui-play.ts";
import { waitMs } from "../helpers/ink-harness.ts";

const CTRL_L = "\x0c";
const CTRL_Z = "\x1a";

describe("TuiApp overlays on the rule engine (e2e)", () => {
  let handle: RuleEngineHandle | undefined;
  let tui: ReturnType<typeof mountLiveTui> | undefined;

  afterEach(async () => {
    tui?.unmount();
    tui = undefined;
    if (handle) await handle.dispose();
    handle = undefined;
  });

  async function boot(opts?: OpenRuleEngineOptions) {
    handle = await openRuleEngine(opts);
    const sceneId = await startScene(handle.engine);
    tui = mountLiveTui({ engine: handle.engine, scene: { sceneId }, mouse: false }, { columns: 120, rows: 40 });
    await waitMs(80);
  }

  /** Plays one typed line to the end of its turn and puts the focus back on the input line. */
  const playLine = (line: string, turnNumber: number): Promise<void> =>
    playTypedLine(tui!, handle!.engine, line, turnNumber);

  test("F2 lists the events of the log and Escape closes it", async () => {
    await boot();
    await playLine("hello log", 1);
    await tui!.press(KEYS.f2);
    expect(await tui!.pollUntil((t) => t.includes("Event log (F2)") && /Showing \d+ events/.test(t), 2000)).toBe(true);
    expect(tui!.getText()).toContain("turn.ended");
    await tui!.press(KEYS.escape);
    expect(await tui!.pollUntil((t) => !t.includes("Event log (F2)"), 2000)).toBe(true);
    await tui!.finish(60);
  });

  test("F3 shows the current branch, the branches and the saves made from the keyboard", async () => {
    await boot();
    await tui!.press(KEYS.ctrlS);
    expect(await eventually(async () => (await handle!.engine.timeline.saves()).length === 1)).toBe(true);
    const [save] = await handle!.engine.timeline.saves();

    await tui!.press(KEYS.f3);
    expect(await tui!.pollUntil((t) => t.includes("Timeline (F3)"), 2000)).toBe(true);
    expect(await tui!.pollUntil((t) => t.includes(`${save!.label} @ ${save!.eventId} (main)`), 2000)).toBe(true);
    expect(tui!.getText()).toContain("Current branch: main");
    expect(tui!.getText()).toContain("▸ main");
    await tui!.press(KEYS.escape);
    expect(await tui!.pollUntil((t) => !t.includes("Timeline (F3)"), 2000)).toBe(true);
    await tui!.finish(60);
  });

  test("Ctrl+L with no saves says so, and with a save Enter loads it, closes the list and reports it", async () => {
    await boot();
    await tui!.press(CTRL_L);
    expect(await tui!.pollUntil((t) => t.includes("No saves yet"), 2000)).toBe(true);
    await tui!.press(KEYS.escape);
    expect(await tui!.pollUntil((t) => !t.includes("No saves yet"), 2000)).toBe(true);

    await tui!.press(KEYS.ctrlS);
    expect(await eventually(async () => (await handle!.engine.timeline.saves()).length === 1)).toBe(true);
    const [save] = await handle!.engine.timeline.saves();
    await playLine("after the save", 1);
    expect(await submitted(handle!.engine)).toEqual(["after the save"]);
    expect(tui!.getText()).toContain("Day 1 08:01");

    await tui!.press(CTRL_L);
    expect(await tui!.pollUntil((t) => t.includes(`${save!.label} · main @ ${save!.eventId}`), 2000)).toBe(true);
    await tui!.press(KEYS.enter);
    expect(await tui!.pollUntil((t) => t.includes(`Loaded ${save!.label}`), 3500)).toBe(true);
    expect(tui!.getText()).not.toContain("Load save (↑/↓ · Enter)");
    // the timeline is back at the saved moment: the turn played after the save is no longer part of it
    expect(await submitted(handle!.engine)).toEqual([]);
    expect(handle!.engine.info().branch).not.toBe("main");
    // the header shows the world as it was when the save was made
    expect(await tui!.pollUntil((t) => t.includes("Day 1 08:00"), 2000)).toBe(true);
    await tui!.finish(60);
  });

  test("the selection in the load list stays on the list however often the arrow is pressed", async () => {
    await boot();
    await tui!.press(KEYS.ctrlS);
    expect(await eventually(async () => (await handle!.engine.timeline.saves()).length === 1)).toBe(true);
    await playLine("one more", 1);
    await tui!.press(KEYS.ctrlS);
    expect(await eventually(async () => (await handle!.engine.timeline.saves()).length === 2)).toBe(true);
    const [first, second] = await handle!.engine.timeline.saves();

    await tui!.press(CTRL_L);
    expect(await tui!.pollUntil((t) => t.includes(`▸ ${first!.label}`), 2000)).toBe(true);
    await tui!.press(...Array<string>(6).fill(KEYS.down));
    expect(await tui!.pollUntil((t) => t.includes(`▸ ${second!.label}`), 2000)).toBe(true);
    // one step back lands on the first slot: the overshoot was not remembered
    await tui!.press(KEYS.up);
    expect(await tui!.pollUntil((t) => t.includes(`▸ ${first!.label}`), 2000)).toBe(true);
    await tui!.press(KEYS.down, KEYS.enter);
    expect(await tui!.pollUntil((t) => t.includes(`Loaded ${second!.label}`), 3500)).toBe(true);
    await tui!.finish(60);
  });

  test("F3 switches to the highlighted branch on Enter", async () => {
    await boot();
    await playLine("a turn to undo", 1);
    await tui!.press(CTRL_Z);
    expect(await tui!.pollUntil((t) => t.includes("Rewind confirm (Ctrl+Z)"), 2000)).toBe(true);
    await tui!.press(KEYS.enter);
    expect(await tui!.pollUntil((t) => t.includes("Rewound branch"), 3500)).toBe(true);
    const rewound = handle!.engine.info().branch;
    expect(rewound).not.toBe("main");
    expect(await submitted(handle!.engine)).toEqual([]);

    const names = (await handle!.engine.timeline.branches()).map((b) => b.name);
    expect(names).toContain("main");
    expect(names).toContain(rewound);
    await tui!.press(KEYS.f3);
    expect(await tui!.pollUntil((t) => t.includes("Timeline (F3)") && t.includes(`Current branch: ${rewound}`), 2000)).toBe(true);
    await tui!.press(...Array<string>(5).fill(KEYS.down));
    expect(await tui!.pollUntil((t) => t.includes(`▸ ${names.at(-1)}`), 2000)).toBe(true);
    await tui!.press(KEYS.up);
    expect(await tui!.pollUntil((t) => t.includes(`▸ ${names[0]}`), 2000)).toBe(true);
    await tui!.press(KEYS.enter);
    expect(await eventually(async () => handle!.engine.info().branch === names[0])).toBe(true);
    // each branch has its own history: the undone turn is back on `main` and still absent on the rewound branch
    const inputsOn = new Map<string, string[]>([
      ["main", ["a turn to undo"]],
      [rewound, []],
    ]);
    expect(await submitted(handle!.engine)).toEqual(inputsOn.get(names[0]!)!);
    await tui!.finish(60);
  });

  test("F6 shows the runtime mode and the presets", async () => {
    await boot();
    await tui!.press(KEYS.f6);
    expect(await tui!.pollUntil((t) => t.includes("Runtime mode (F6)"), 2000)).toBe(true);
    expect(tui!.getText()).toContain("Now: [");
    expect(tui!.getText()).toContain("rule");
    await tui!.press(KEYS.escape);
    expect(await tui!.pollUntil((t) => !t.includes("Runtime mode (F6)"), 2000)).toBe(true);
    await tui!.finish(60);
  });

  test("F4 explains the last turn", async () => {
    await boot();
    expect(await (async () => { await tui!.press(KEYS.f4); return tui!.pollUntil((t) => t.includes("No turn to explain yet."), 2000); })()).toBe(true);
    await tui!.press(KEYS.escape);
    await playLine("tell me", 1);
    await tui!.press(KEYS.f4);
    expect(await tui!.pollUntil((t) => /Explain turn_\d+/.test(t), 3000)).toBe(true);
    await tui!.press(KEYS.escape);
    await tui!.finish(60);
  });

  test("Ctrl+Z asks before rewinding the last turn, and Enter takes the timeline back to before it", async () => {
    await boot();
    await playLine("take me back", 1);
    expect(await submitted(handle!.engine)).toEqual(["take me back"]);
    expect(tui!.getText()).toContain("Day 1 08:01");

    await tui!.press(CTRL_Z);
    expect(await tui!.pollUntil((t) => t.includes("Rewind confirm (Ctrl+Z)"), 2000)).toBe(true);
    await tui!.press(KEYS.escape);
    expect(await tui!.pollUntil((t) => !t.includes("Rewind confirm (Ctrl+Z)"), 2000)).toBe(true);
    // declining changes nothing
    expect(await submitted(handle!.engine)).toEqual(["take me back"]);
    expect(handle!.engine.info().branch).toBe("main");

    await tui!.press(CTRL_Z);
    expect(await tui!.pollUntil((t) => t.includes("Rewind confirm (Ctrl+Z)"), 2000)).toBe(true);
    await tui!.press(KEYS.enter);
    expect(await tui!.pollUntil((t) => t.includes("Rewound branch"), 3500)).toBe(true);
    expect(handle!.engine.info().branch).not.toBe("main");
    expect(await submitted(handle!.engine)).toEqual([]);
    // no turn is left open on the new branch, and the header shows the world as it was before the turn
    expect(await handle!.engine.timeline.events({ kinds: ["turn.started"] })).toEqual([]);
    assertLogInvariants(await handle!.engine.timeline.events());
    expect(await tui!.pollUntil((t) => t.includes("Day 1 08:00"), 2000)).toBe(true);
    await tui!.finish(60);
  });

  test("Ctrl+Z with no turn played says there is nothing to rewind", async () => {
    await boot();
    await tui!.press(CTRL_Z);
    expect(await tui!.pollUntil((t) => t.includes("No prior turn to rewind"), 2000)).toBe(true);
    expect(tui!.getText()).not.toContain("Rewind confirm (Ctrl+Z)");
    expect(handle!.engine.info().branch).toBe("main");
    await tui!.finish(60);
  });

  test("a policy that forbids rewinding is reported, the overlay closes and the game goes on", async () => {
    await boot({ preset: rulePreset({ timeline: { allowRewind: false } }) });
    await playLine("stay here", 1);

    await tui!.press(CTRL_Z);
    expect(await tui!.pollUntil((t) => t.includes("Rewind confirm (Ctrl+Z)"), 2000)).toBe(true);
    await tui!.press(KEYS.enter);
    expect(await tui!.pollUntil((t) => t.includes("Rewind disabled by policy"), 3500)).toBe(true);
    expect(tui!.getText()).not.toContain("Rewind confirm (Ctrl+Z)");
    expect(handle!.engine.info().branch).toBe("main");

    // the app did not crash: the next line is played normally
    await playLine("still here", 2);
    expect(await submitted(handle!.engine)).toEqual(["stay here", "still here"]);
    await tui!.finish(60);
  });
});
