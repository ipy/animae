import { describe, expect, test } from "bun:test";
import { Text } from "ink";
import { useActionRunner } from "../src/context/action-runner-context.tsx";
import { PromptDialog } from "../src/components/PromptDialog.tsx";
import { createTuiFakeEngine } from "./helpers/fake-engine.ts";
import { createInkHarness, flushInkFrame, waitMs } from "./helpers/ink-harness.ts";
import { After, FullTuiTestShell } from "./helpers/tui-shell.tsx";
import type { TuiAction } from "../src/types.ts";

function RunnerProbe({ onReady }: { onReady: (run: ReturnType<typeof useActionRunner>) => void }) {
  const runner = useActionRunner();
  return (
    <After
      delayMs={10}
      run={() => onReady(runner)}
    />
  );
}

describe("ActionRunnerProvider", () => {
  test("runAction without args executes immediately", async () => {
    let ran = false;
    const action: TuiAction = {
      id: "go",
      label: "Go",
      run: () => {
        ran = true;
      },
    };
    const harness = createInkHarness(
      <FullTuiTestShell engine={createTuiFakeEngine()} actions={[action]}>
        <RunnerProbe
          onReady={(r) => {
            void r.runAction(action);
          }}
        />
      </FullTuiTestShell>,
    );
    await waitMs(80);
    harness.unmount();
    expect(ran).toBe(true);
  });

  test("runAction with missing required fields opens prompt", async () => {
    const action: TuiAction = {
      id: "need",
      label: "Need",
      args: [{ id: "x", label: "X", type: "text" }],
      run: () => {},
    };
    const harness = createInkHarness(
      <FullTuiTestShell engine={createTuiFakeEngine()} actions={[action]}>
        <RunnerProbe onReady={(r) => void r.runAction(action)} />
        <PromptDialog />
      </FullTuiTestShell>,
    );
    expect(await flushInkFrame(harness, 80)).toContain("Input (Esc to close)");
  });
});
