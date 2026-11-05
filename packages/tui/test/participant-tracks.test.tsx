import { describe, expect, test } from "bun:test";
import { ParticipantTracks } from "../src/components/ParticipantTracks.tsx";
import { createTuiFakeEngine } from "./helpers/fake-engine.ts";
import { flushInkFrame, createInkHarness } from "./helpers/ink-harness.ts";
import { TuiTestShell } from "./helpers/tui-shell.tsx";

describe("ParticipantTracks", () => {
  test("renders tier lines toward player and self tracks", async () => {
    const engine = createTuiFakeEngine({
      query: (_v, path) => {
        if (path === "scene") return { participants: ["player", "mira"] };
        if (path === "characters/mira/tiers") {
          return {
            toward: { player: { bond: "close" } },
            self: { mood: "warm" },
          };
        }
        return null;
      },
      queryAsync: async (_v, path) => {
        if (path === "scene") return { participants: ["player", "mira"] };
        if (path === "characters/mira/tiers") {
          return {
            toward: { player: { bond: "close" } },
            self: { mood: "warm" },
          };
        }
        return null;
      },
    });
    const frame = await flushInkFrame(
      createInkHarness(
        <TuiTestShell engine={engine}>
          <ParticipantTracks />
        </TuiTestShell>,
      ),
      100,
    );
    expect(frame).toContain("mira");
    expect(frame).toContain("bond");
    expect(frame).toContain("mood");
  });
});
