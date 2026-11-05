import { describe, expect, test } from "bun:test";
import type { TurnChunk } from "@animae/engine";
import { appStateReducer, initialAppState, type AppStateAction } from "../src/context/app-state-context.tsx";
import { consumeTurnStream } from "../src/hooks/consume-turn.ts";

async function playChoices(chunks: TurnChunk[]) {
  let state = initialAppState();
  const actions: AppStateAction[] = [];
  const dispatch = (a: AppStateAction) => {
    actions.push(a);
    state = appStateReducer(state, a);
  };
  async function* gen() {
    for (const c of chunks) yield c;
  }
  await consumeTurnStream(gen(), dispatch, { actor: "player" });
  return { state, actions };
}

describe("consumeTurnStream deferred choices", () => {
  test("choice menu appears only after the stream finishes", async () => {
    const chunks: TurnChunk[] = [
      { type: "text", text: "hi", speaker: "player", newUtterance: true },
      {
        type: "choices",
        choices: [{ id: "c1", text: "Go.", expected_event_type: "chat", tags: [] }],
      },
      { type: "done", turnId: "turn_0001", events: [] },
    ];
    const { state, actions } = await playChoices(chunks);
    const choiceActions = actions.filter((a) => a.type === "setChoices");
    expect(choiceActions.length).toBe(1);
    expect(state.choices?.choices[0]?.text).toBe("Go.");
    expect(state.focus).toBe("choices");
  });
});
