import { describe, expect, test } from "bun:test";
import { Box } from "ink";
import { handlePromptKey } from "../src/components/PromptDialog.tsx";
import {
  AutocompletePopup,
  applyTabAutocomplete,
  commandAutocompleteOnly,
} from "../src/components/AutocompletePopup.tsx";
import { CommandPalette } from "../src/components/CommandPalette.tsx";
import { ActionToolbar } from "../src/components/ActionToolbar.tsx";
import { EntityActionMenu } from "../src/components/EntityActionMenu.tsx";
import { ChoiceMenu } from "../src/components/ChoiceMenu.tsx";
import type { AppState } from "../src/context/app-state-context.tsx";
import { testAppState } from "./helpers/app-state-test.ts";
import { inkKey } from "./helpers/ink-key.ts";
import { createTuiFakeEngine } from "./helpers/fake-engine.ts";
import { createInkHarness, flushInkFrame } from "./helpers/ink-harness.ts";
import { DispatchOnMount, FullTuiTestShell, SetInputDraftOnMount } from "./helpers/tui-shell.tsx";
import type { EntityTuiAction, TuiAction } from "../src/types.ts";

describe("prompt and autocomplete", () => {
  test("handlePromptKey edits text fields and completes", async () => {
    const dispatchCalls: unknown[] = [];
    const dispatch = (a: unknown) => dispatchCalls.push(a);
    const state: AppState = testAppState({
      prompt: {
        title: "t",
        fields: [{ id: "name", label: "Name", type: "text" }],
        values: { name: "" },
        fieldIndex: 0,
      },
    });
    let completed: Record<string, string> | undefined;
    await handlePromptKey(state, dispatch as never, async (v) => {
      completed = v;
    }, { key: inkKey({}), input: "a", name: "a" });
    await handlePromptKey(
      { ...state, prompt: { ...state.prompt!, values: { name: "a" } } },
      dispatch as never,
      async (v) => {
        completed = v;
      },
      { key: inkKey({ return: true }), input: "\r", name: "return" },
    );
    expect(completed).toEqual({ name: "a" });
  });

  test("applyTabAutocomplete picks command prefix", () => {
    const state = testAppState({
      autocompleteOpen: true,
      autocompleteIndex: 0,
      inputDraft: ":sa",
      inputCursor: 3,
    });
    const patches: unknown[] = [];
    const ok = applyTabAutocomplete(state, (a) => patches.push(a), [], {}, undefined, ":sa");
    expect(ok).toBe(true);
    expect(commandAutocompleteOnly(":mo", {})).toContain(":mode");
  });

  test("AutocompletePopup lists colon commands", async () => {
    const engine = createTuiFakeEngine();
    const harness = createInkHarness(
      <FullTuiTestShell engine={engine}>
        <DispatchOnMount actions={[{ type: "setAutocomplete", open: true, index: 0 }]} />
        <SetInputDraftOnMount value=":hel" cursor={4} />
        <AutocompletePopup nameHints={["Mira"]} />
      </FullTuiTestShell>,
    );
    expect(await flushInkFrame(harness, 60)).toContain(":help");
  });
});

describe("palette toolbar entity menu choices", () => {
  const toolbarAction: TuiAction = {
    id: "ping",
    label: "Ping",
    hotkey: "P",
    run: () => {},
  };
  const entityAction: EntityTuiAction = {
    id: "talk",
    label: "Talk",
    run: () => {},
  };

  test("CommandPalette lists built-in commands", async () => {
    const harness = createInkHarness(
      <FullTuiTestShell engine={createTuiFakeEngine()} actions={[toolbarAction]}>
        <DispatchOnMount actions={[{ type: "setPalette", open: true, query: "save" }]} />
        <CommandPalette />
      </FullTuiTestShell>,
    );
    expect(await flushInkFrame(harness, 60)).toContain(":save");
  });

  test("ActionToolbar shows configured actions", async () => {
    const harness = createInkHarness(
      <FullTuiTestShell engine={createTuiFakeEngine()} actions={[toolbarAction]}>
        <Box width={120}>
          <ActionToolbar width={120} />
        </Box>
      </FullTuiTestShell>,
    );
    expect(await flushInkFrame(harness, 40)).toContain("Ping");
  });

  test("EntityActionMenu lists actions for focus target", async () => {
    const harness = createInkHarness(
      <FullTuiTestShell engine={createTuiFakeEngine()} entityActions={[entityAction]}>
        <DispatchOnMount
          actions={[
            { type: "setFocusTarget", target: "mira" },
            { type: "setEntityMenu", open: true },
          ]}
        />
        <EntityActionMenu />
      </FullTuiTestShell>,
    );
    expect(await flushInkFrame(harness, 40)).toContain("Talk");
  });

  test("ChoiceMenu submits selected choice", async () => {
    const engine = createTuiFakeEngine();
    const harness = createInkHarness(
      <FullTuiTestShell engine={engine}>
        <DispatchOnMount
          actions={[
            {
              type: "setChoices",
              choices: { choices: [{ id: "c1", text: "Go north" }], selected: 0 },
            },
          ]}
        />
        <ChoiceMenu />
      </FullTuiTestShell>,
    );
    expect(await flushInkFrame(harness, 150)).toContain("Go north");
  });
});
