import { describe, expect, test } from "bun:test";
import { appStateReducer, initialAppState, type AppState, type AppStateAction } from "../src/context/app-state-context.tsx";

const run = (state: AppState, ...actions: AppStateAction[]): AppState => actions.reduce(appStateReducer, state);

describe("palette actions are relative to the reducer state", () => {
  const open = (query = ""): AppState => run(initialAppState(), { type: "setPalette", open: true, query, index: 0 });

  test("insert and backspace build on the query the previous action left, however many arrive before a render", () => {
    const state = run(
      open(),
      { type: "paletteInsert", text: "s" },
      { type: "paletteInsert", text: "av" },
      { type: "paletteInsert", text: "e" },
    );
    expect(state.paletteQuery).toBe("save");
    expect(run(state, { type: "paletteBackspace" }, { type: "paletteBackspace" }).paletteQuery).toBe("sa");
    expect(run(open(), { type: "paletteBackspace" }).paletteQuery).toBe("");
  });

  test("a change of the query puts the selection back on the first entry", () => {
    const moved = run(open(), { type: "paletteMove", delta: 1 }, { type: "paletteMove", delta: 1 });
    expect(moved.paletteIndex).toBe(2);
    expect(run(moved, { type: "paletteInsert", text: "x" }).paletteIndex).toBe(0);
    expect(run(moved, { type: "paletteBackspace" }).paletteIndex).toBe(0);
  });

  test("moves add up, never go below the first entry and honour an upper bound when one is given", () => {
    const down3 = run(open(), ...Array.from({ length: 3 }, (): AppStateAction => ({ type: "paletteMove", delta: 1 })));
    expect(down3.paletteIndex).toBe(3);
    expect(run(down3, { type: "paletteMove", delta: -10 }).paletteIndex).toBe(0);
    expect(run(down3, { type: "paletteMove", delta: 0, max: 1 }).paletteIndex).toBe(1);
    expect(run(down3, { type: "paletteMove", delta: 1, max: 9 }).paletteIndex).toBe(4);
  });
});

describe("moveChoice", () => {
  const menu = (selected = 0): AppState =>
    run(initialAppState(), {
      type: "setChoices",
      choices: { choices: [{ id: "a", text: "A" }, { id: "b", text: "B" }, { id: "c", text: "C" }], selected },
    });

  test("steps that arrive together all count, and stop at both ends", () => {
    const down = { type: "moveChoice", delta: 1 } as const;
    const up = { type: "moveChoice", delta: -1 } as const;
    expect(run(menu(), down, down).choices?.selected).toBe(2);
    expect(run(menu(), down, down, down, down).choices?.selected).toBe(2);
    expect(run(menu(2), up, up, up).choices?.selected).toBe(0);
    expect(run(menu(1), up, down, down).choices?.selected).toBe(2);
  });

  test("changes nothing when there is no menu", () => {
    const state = initialAppState();
    expect(run(state, { type: "moveChoice", delta: 1 })).toBe(state);
  });
});
