import { describe, expect, test } from "bun:test";
import { handlePromptKey } from "../src/components/PromptDialog.tsx";
import type { AppState, AppStateAction } from "../src/context/app-state-context.tsx";

function stateWithPrompt(partial: Partial<AppState["prompt"]> & Pick<NonNullable<AppState["prompt"]>, "fields">): AppState {
  return {
    prompt: {
      title: "T",
      fields: partial.fields,
      fieldIndex: partial.fieldIndex ?? 0,
      values: partial.values ?? {},
    },
  } as AppState;
}

describe("handlePromptKey text fields", () => {
  test("types characters and advances multi-step prompt", async () => {
    const actions: AppStateAction[] = [];
    const dispatch = (a: AppStateAction) => actions.push(a);
    const st = stateWithPrompt({
      fields: [
        { id: "a", label: "A", type: "text" },
        { id: "b", label: "B", type: "text" },
      ],
    });
    await handlePromptKey(st, dispatch, async () => {}, {
      key: { escape: false, return: false, ctrl: false, backspace: false, upArrow: false, downArrow: false } as never,
      input: "z",
      name: "",
    });
    expect(actions.some((a) => a.type === "patchPrompt")).toBe(true);

    await handlePromptKey(
      { ...st, prompt: { ...st.prompt!, values: { a: "ok" } } },
      dispatch,
      async () => {},
      {
        key: { escape: false, return: true, ctrl: false, backspace: false, upArrow: false, downArrow: false } as never,
        input: "",
        name: "return",
      },
    );
    expect(
      actions.some(
        (a) =>
          a.type === "patchPrompt" &&
          "fieldIndex" in a.patch &&
          a.patch.fieldIndex === 1,
      ),
    ).toBe(true);
  });

  test("backspace edits current field", async () => {
    const actions: AppStateAction[] = [];
    const dispatch = (a: AppStateAction) => actions.push(a);
    const st = stateWithPrompt({
      fields: [{ id: "a", label: "A", type: "text" }],
      values: { a: "ab" },
    });
    await handlePromptKey(st, dispatch, async () => {}, {
      key: { escape: false, return: false, ctrl: false, backspace: true, upArrow: false, downArrow: false } as never,
      input: "",
      name: "backspace",
    });
    const patch = actions.find((a) => a.type === "patchPrompt");
    expect(patch).toBeDefined();
  });
});
