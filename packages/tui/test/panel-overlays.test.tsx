import { describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { Box } from "ink";
import { ExplainView } from "../src/components/ExplainView.tsx";
import { EventLog } from "../src/components/EventLog.tsx";
import { FieldList } from "../src/components/FieldList.tsx";
import { GalleryPanel } from "../src/components/GalleryPanel.tsx";
import { Inspector } from "../src/components/Inspector.tsx";
import { LoadSlots } from "../src/components/LoadSlots.tsx";
import { TimelineBrowser } from "../src/components/TimelineBrowser.tsx";
import type { GalleryItemView } from "@animae/engine";
import { createTuiFakeEngine, createTuiFakeEngineControls } from "./helpers/fake-engine.ts";
import { createInkHarness, flushInkFrame } from "./helpers/ink-harness.ts";
import { DispatchOnMount, FullTuiTestShell } from "./helpers/tui-shell.tsx";

async function frame(node: ReactNode, engine = createTuiFakeEngine()): Promise<string> {
  const harness = createInkHarness(
    <FullTuiTestShell engine={engine}>
      <Box width={80} height={24}>
        {node}
      </Box>
    </FullTuiTestShell>,
  );
  return flushInkFrame(harness, 100);
}

describe("overlay panels", () => {
  test("ExplainView empty and with turn chain", async () => {
    const empty = await frame(<ExplainView />);
    expect(empty).toContain("No turn to explain yet.");
    const withTurn = await frame(
      <>
        <DispatchOnMount actions={[{ type: "setLastTurnId", turnId: "turn_0001" as never }]} />
        <ExplainView />
      </>,
    );
    expect(withTurn).toContain("utterance");
  });

  test("Inspector renders query trees", async () => {
    const engine = createTuiFakeEngine({
      query: (_v, path) => {
        if (path === "scene") return { id: "scn_0001" };
        if (path === "director/beat") return { id: "beat1" };
        if (path === "director/anchors") return [];
        return null;
      },
      queryAsync: async (_v, path) => {
        if (path === "scene") return { id: "scn_0001" };
        if (path === "director/beat") return { id: "beat1" };
        if (path === "director/anchors") return [];
        return null;
      },
    });
    const text = await frame(<Inspector />, engine);
    expect(text).toContain("scene");
    expect(text).toContain("director/beat");
  });

  test("FieldList empty and populated", async () => {
    const emptyEngine = createTuiFakeEngine({
      query: () => null,
      queryAsync: async () => null,
    });
    expect(await frame(<FieldList />, emptyEngine)).toContain("No visible fields");
    const engine = createTuiFakeEngine({
      query: (_v, p) => (p === "world/fields" ? [{ id: "f1", name: "Luck" }] : null),
      queryAsync: async (_v, p) => (p === "world/fields" ? [{ id: "f1", name: "Luck" }] : null),
    });
    expect(await frame(<FieldList />, engine)).toContain("Luck");
  });

  test("EventLog lists engine events", async () => {
    const { engine, emit } = createTuiFakeEngineControls();
    emit("utterance", { id: "evt_u1" });
    const text = await frame(<EventLog />, engine);
    expect(text).toContain("utterance");
    expect(text).toMatch(/evt_\w+/);
  });

  test("LoadSlots and TimelineBrowser show saves and branches", async () => {
    const engine = createTuiFakeEngine({
      timeline: {
        ...createTuiFakeEngine().timeline,
        saves: async () => [{ label: "qs", branch: "main", eventId: "evt_0", createdAt: "" }],
        branches: async () => [{ name: "main" }, { name: "fork" }],
      },
    });
    expect(await frame(<LoadSlots selected={0} />, engine)).toContain("qs");
    const timeline = await frame(
      <>
        <DispatchOnMount actions={[{ type: "setPendingRewind", eventId: "evt_5" }]} />
        <TimelineBrowser selectedBranch={1} />
      </>,
      engine,
    );
    expect(timeline).toContain("fork");
    expect(timeline).toContain("evt_5");
  });

  test("GalleryPanel lists items and masked presentation", async () => {
    const item: GalleryItemView = {
      id: "g1",
      kind: "preset",
      title: "Secret",
      order: 1,
      rating: "general",
      available: true,
      unlocked: true,
      characters: [],
      tags: [],
      job: { id: "job_g1", item: "g1", state: "rendering", progress: 0.5 },
    };
    const engine = createTuiFakeEngine({
      gallery: {
        ...createTuiFakeEngine().gallery,
        list: async () => [item],
      },
    });
    const revealed = new Set<string>();
    const harness = createInkHarness(
      <FullTuiTestShell engine={engine}>
        <GalleryPanel
          selected={0}
          revealed={revealed}
          onToggleReveal={() => {}}
          locale="en"
          onRefresh={() => {}}
          presentation={() => ({ blur: true })}
        />
      </FullTuiTestShell>,
    );
    expect(await flushInkFrame(harness, 80)).toContain("Restricted entry");
  });
});
