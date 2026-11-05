import { describe, expect, test } from "bun:test";
import type { Engine, EngineEvent } from "@animae/engine";
import { lastTurnRewindTarget } from "../src/utils/rewind-target.ts";

function engineWith(kinds: readonly string[]): Pick<Engine, "timeline"> {
  const events = kinds.map(
    (kind, i) =>
      ({ id: `evt_${String(i + 1).padStart(4, "0")}`, kind, t: { day: 1, minute: 480 }, source: "test", because: [] }) as unknown as EngineEvent,
  );
  return { timeline: { events: async () => events } as unknown as Engine["timeline"] };
}

describe("lastTurnRewindTarget", () => {
  test("is the event just before the last turn starts, where the previous turn ended", async () => {
    const engine = engineWith([
      "scene.started", // evt_0001
      "turn.started", // evt_0002: first turn
      "input.received",
      "route.decided",
      "turn.ended", // evt_0005
      "turn.started", // evt_0006: last turn
      "input.received",
      "route.decided",
      "memory.written",
      "turn.ended",
    ]);
    expect(await lastTurnRewindTarget(engine)).toBe("evt_0005");
  });

  test("goes back to before the turn, not to its input, so no turn is left open", async () => {
    const engine = engineWith(["scene.started", "turn.started", "input.received", "turn.ended"]);
    expect(await lastTurnRewindTarget(engine)).toBe("evt_0001");
  });

  test("keeps what happened between the turns", async () => {
    const engine = engineWith(["scene.started", "turn.started", "turn.ended", "time.advanced", "world.moved", "turn.started", "input.received", "turn.ended"]);
    expect(await lastTurnRewindTarget(engine)).toBe("evt_0005");
  });

  test("undoes a turn that never ended", async () => {
    const engine = engineWith(["scene.started", "turn.started", "turn.ended", "turn.started", "input.received", "appraisal"]);
    expect(await lastTurnRewindTarget(engine)).toBe("evt_0003");
  });

  test("is undefined when no turn was played", async () => {
    expect(await lastTurnRewindTarget(engineWith(["scene.started"]))).toBeUndefined();
    expect(await lastTurnRewindTarget(engineWith([]))).toBeUndefined();
  });

  test("is undefined when the turn start is the very first event, since nothing precedes it", async () => {
    expect(await lastTurnRewindTarget(engineWith(["turn.started", "input.received", "turn.ended"]))).toBeUndefined();
  });

  test("ignores events that follow the last turn", async () => {
    const engine = engineWith(["scene.started", "turn.started", "input.received", "turn.ended", "time.advanced", "scene.ended"]);
    expect(await lastTurnRewindTarget(engine)).toBe("evt_0001");
  });
});
