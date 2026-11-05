import { describe, expect, test } from "bun:test";
import { Text } from "ink";
import { useEffect } from "react";
import { useTurn } from "../src/hooks/use-turn.ts";
import { createTuiFakeEngine } from "./helpers/fake-engine.ts";
import { createInkHarness, flushInkFrame } from "./helpers/ink-harness.ts";
import { EngineProvider } from "../src/context/engine-context.tsx";
import { AppStateProvider, useAppState } from "../src/context/app-state-context.tsx";
import { ThemeProvider } from "../src/context/theme-context.tsx";
import { TuiI18nProvider } from "../src/i18n/context.tsx";
import { createCueRegistry } from "../src/cues/registry.ts";
import { loadTheme } from "../src/theme/load.ts";
import { MouseProvider } from "../src/context/mouse-context.tsx";

function TranscriptChoices() {
  const { state } = useAppState();
  const text = state.transcript.map((e) => ("text" in e ? e.text : "")).join("|");
  const choices = state.choices?.choices.map((c) => c.text).join(",") ?? "";
  return <Text>{text}|{choices}</Text>;
}

function SubmitOnce({ text }: { text: string }) {
  const { submit } = useTurn();
  useEffect(() => {
    void submit(text);
  }, []);
  return null;
}

describe("useTurn free roam", () => {
  test("resolveFreeInput dispatches choices when scene is missing", async () => {
    const base = createTuiFakeEngine();
    const engine = createTuiFakeEngine({
      scene: { ...base.scene, active: () => null },
    });
    const frame = await flushInkFrame(
      createInkHarness(
        <EngineProvider value={{ engine, viewer: "player", actor: "player" }}>
          <ThemeProvider theme={loadTheme(undefined)}>
            <AppStateProvider
              engine={engine}
              viewer="player"
              actor="player"
              initialSceneId={undefined}
              config={{
                cueRegistry: createCueRegistry(),
                customCommands: {},
                panels: [],
                actions: [],
                entityActions: [],
                theme: loadTheme(undefined),
                nameHints: [],
                resolveFreeInput: async (ctx) => {
                  ctx.dispatch?.("Pick a path", [{ id: "a", label: "Path A" }]);
                  return "handled";
                },
              }}
            >
              <TuiI18nProvider initialLocale="en">
                <MouseProvider mouseOption={false}>
                  <SubmitOnce text="where?" />
                  <TranscriptChoices />
                </MouseProvider>
              </TuiI18nProvider>
            </AppStateProvider>
          </ThemeProvider>
        </EngineProvider>,
      ),
      200,
    );
    expect(frame).toContain("Pick a path");
    expect(frame).toContain("Path A");
  });
});
