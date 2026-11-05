import type { TurnCtx } from "../../src/contracts.ts";

/** Minimal valid turn context for unit tests (hooks, memory writing, etc.). */
export function testTurnCtx(overrides: Partial<TurnCtx> = {}): TurnCtx {
  return {
    turnId: "turn_1",
    sceneId: "scn_1",
    actor: "player",
    addressee: "npc1",
    speaker: "npc1",
    text: "hello",
    autonomous: false,
    ...overrides,
  };
}

/** Turn slice accepted by `buildCallContext`. */
export function testCallContextTurn(overrides: Partial<Pick<TurnCtx, "turnId" | "autonomous" | "outputLocale">> = {}) {
  return { turnId: "turn_1", autonomous: false, ...overrides };
}
