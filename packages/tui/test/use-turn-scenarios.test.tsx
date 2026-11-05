import { describe, expect, test } from "bun:test";
import { Text } from "ink";
import { useAppState } from "../src/context/app-state-context.tsx";
import { useTurn } from "../src/hooks/use-turn.ts";
import { createTuiFakeEngine } from "./helpers/fake-engine.ts";
import { flushInkFrame, createInkHarness } from "./helpers/ink-harness.ts";
import { FullTuiTestShell, RunTurn } from "./helpers/tui-shell.tsx";

function TranscriptText() {
  const { state } = useAppState();
  const text = state.transcript.map((e) => ("text" in e ? e.text : "")).join("|");
  return <Text>{text}</Text>;
}

function TurnErrorProbe() {
  const { error } = useTurn();
  return <Text>{error ?? ""}</Text>;
}

describe("useTurn scenarios", () => {
  test("without active scene appends no-scene system line", async () => {
    const base = createTuiFakeEngine();
    const engine = createTuiFakeEngine({
      scene: {
        ...base.scene,
        active: () => null,
      },
    });
    const frame = await flushInkFrame(
      createInkHarness(
        <FullTuiTestShell engine={engine}>
          <RunTurn text="hello" />
          <TranscriptText />
        </FullTuiTestShell>,
      ),
      200,
    );
    expect(frame).toContain("No active scene");
  });

  test("turn failure surfaces error system line", async () => {
    const base = createTuiFakeEngine();
    const engine = createTuiFakeEngine({
      scene: {
        ...base.scene,
        turn: async function* () {
          throw new Error("boom-turn");
        },
      },
    });
    const frame = await flushInkFrame(
      createInkHarness(
        <FullTuiTestShell engine={engine}>
          <RunTurn text="fail" />
          <TranscriptText />
          <TurnErrorProbe />
        </FullTuiTestShell>,
      ),
      200,
    );
    expect(frame).toContain("boom-turn");
  });
});
