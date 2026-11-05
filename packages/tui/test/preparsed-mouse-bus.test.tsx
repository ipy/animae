import { describe, expect, test } from "bun:test";
import { Text } from "ink";
import { useEffect } from "react";
import { emitPreparsedMouse, preparsedMouseBus } from "../src/input/preparsed-mouse-bus.ts";
import { MouseCaptureBridge } from "../src/app/MouseCaptureBridge.tsx";
import { useMouseDispatch } from "../src/context/mouse-context.tsx";
import { ThemeProvider } from "../src/context/theme-context.tsx";
import { defaultTheme } from "../src/theme/defaults.ts";
import { AppStateProvider } from "../src/context/app-state-context.tsx";
import { EngineProvider } from "../src/context/engine-context.tsx";
import { createCueRegistry } from "../src/cues/registry.ts";
import { loadTheme } from "../src/theme/load.ts";
import { createTuiFakeEngine } from "./helpers/fake-engine.ts";
import { createInkHarness, flushInkFrame } from "./helpers/ink-harness.ts";
import { testSgrMouse } from "./helpers/sgr-mouse-test.ts";
import { PassThrough } from "node:stream";

function DispatchCounter({ onMotion }: { onMotion: () => void }) {
  const dispatch = useMouseDispatch();
  useEffect(() => {
    const onSgr = (ev: ReturnType<typeof testSgrMouse>) => {
      dispatch(ev);
      if (ev.kind === "motion") onMotion();
    };
    preparsedMouseBus.on("sgr", onSgr);
    emitPreparsedMouse(testSgrMouse({ kind: "motion", col: 2, row: 2 }));
    return () => {
      preparsedMouseBus.off("sgr", onSgr);
    };
  }, [dispatch, onMotion]);
  return <Text>bus</Text>;
}

describe("preparsed mouse bus", () => {
  test("emitPreparsedMouse delivers events to bus listeners", () => {
    let seen = 0;
    const onSgr = () => {
      seen += 1;
    };
    preparsedMouseBus.on("sgr", onSgr);
    emitPreparsedMouse(testSgrMouse({ col: 3, row: 4 }));
    preparsedMouseBus.off("sgr", onSgr);
    expect(seen).toBe(1);
  });

  test("PreparsedMouseBridge forwards bus events when capture enabled", async () => {
    let motion = 0;
    const engine = createTuiFakeEngine();
    const stdout = Object.assign(new PassThrough(), { isTTY: true, columns: 80, rows: 24 });
    const frame = await flushInkFrame(
      createInkHarness(
        <EngineProvider value={{ engine, viewer: "player", actor: "player" }}>
          <ThemeProvider theme={defaultTheme}>
            <AppStateProvider
              engine={engine}
              viewer="player"
              actor="player"
              initialSceneId="scn_0001"
              config={{
                cueRegistry: createCueRegistry(),
                customCommands: {},
                panels: [],
                actions: [],
                entityActions: [],
                theme: loadTheme(undefined),
                nameHints: [],
              }}
            >
              <MouseCaptureBridge mouseOption={true} stdout={stdout}>
                <DispatchCounter onMotion={() => (motion += 1)} />
              </MouseCaptureBridge>
            </AppStateProvider>
          </ThemeProvider>
        </EngineProvider>,
      ),
      150,
    );
    expect(frame).toContain("bus");
    expect(motion).toBeGreaterThan(0);
  });
});
