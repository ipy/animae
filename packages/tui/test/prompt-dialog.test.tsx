import { describe, expect, test } from "bun:test";
import { handlePromptKey, PromptDialog } from "../src/components/PromptDialog.tsx";
import type { AppState } from "../src/context/app-state-context.tsx";
import { testAppState } from "./helpers/app-state-test.ts";
import { inkKey } from "./helpers/ink-key.ts";
import { createTuiFakeEngine } from "./helpers/fake-engine.ts";
import { DispatchOnMount, FullTuiTestShell } from "./helpers/tui-shell.tsx";
import { flushInkFrame, createInkHarness } from "./helpers/ink-harness.ts";

function promptState(overrides: Partial<NonNullable<AppState["prompt"]>> = {}): AppState {
  return testAppState({
    prompt: {
      title: "Title",
      fields: [{ id: "name", label: "Name", type: "text" }],
      values: { name: "" },
      fieldIndex: 0,
      ...overrides,
    },
  });
}

describe("PromptDialog", () => {
  test("handlePromptKey escape clears prompt", async () => {
    const patches: unknown[] = [];
    const dispatch = (a: unknown) => patches.push(a);
    await handlePromptKey(promptState(), dispatch as never, async () => {}, {
      key: inkKey({ escape: true }),
      input: "\x1b",
      name: "escape",
    });
    expect(patches).toContainEqual({ type: "setPrompt", prompt: undefined });
  });

  test("handlePromptKey select field moves with arrows and confirms", async () => {
    const state = promptState({
      fields: [
        {
          id: "mode",
          label: "Mode",
          type: "select",
          options: [
            { value: "a", label: "Alpha" },
            { value: "b", label: "Beta" },
          ],
        },
      ],
      values: { mode: "a" },
    });
    const patches: unknown[] = [];
    const dispatch = (a: unknown) => patches.push(a);
    await handlePromptKey(state, dispatch as never, async () => {}, {
      key: inkKey({ downArrow: true }),
      input: "",
      name: "down",
    });
    expect(patches.some((p) => (p as { type: string }).type === "patchPrompt")).toBe(true);
    let completed: Record<string, string> | undefined;
    await handlePromptKey(
      { ...state, prompt: { ...state.prompt!, values: { mode: "b" } } },
      dispatch as never,
      async (v) => {
        completed = v;
      },
      { key: inkKey({ return: true }), input: "\r", name: "return" },
    );
    expect(completed?.mode).toBe("b");
  });

  test("renders select options in overlay", async () => {
    const engine = createTuiFakeEngine();
    const text = await flushInkFrame(
      createInkHarness(
        <FullTuiTestShell engine={engine}>
          <DispatchOnMount
            actions={[
              {
                type: "setPrompt",
                prompt: {
                  title: "Pick",
                  fields: [
                    {
                      id: "tier",
                      label: "Tier",
                      type: "select",
                      options: [{ value: "x", label: "Extra" }],
                    },
                  ],
                  values: { tier: "x" },
                  fieldIndex: 0,
                },
              },
            ]}
          />
          <PromptDialog />
        </FullTuiTestShell>,
      ),
      80,
    );
    expect(text).toContain("Extra");
    expect(text).toContain("▸");
  });

  test("text prompt shows typed value", async () => {
    const engine = createTuiFakeEngine();
    const text = await flushInkFrame(
      createInkHarness(
        <FullTuiTestShell engine={engine}>
          <DispatchOnMount
            actions={[
              {
                type: "setPrompt",
                prompt: {
                  title: "Input",
                  fields: [{ id: "x", label: "X", type: "text" }],
                  values: { x: "typed" },
                  fieldIndex: 0,
                },
              },
            ]}
          />
          <PromptDialog />
        </FullTuiTestShell>,
      ),
      60,
    );
    expect(text).toContain("typed");
  });
});
