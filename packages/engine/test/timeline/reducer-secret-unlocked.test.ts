import { expect, test } from "bun:test";
import { reduce } from "../../src/timeline/reducer.ts";
import { initialState } from "../../src/timeline/initial-state.ts";
import { minimalAuthored, minimalPolicy } from "./fixture.ts";
import type { EngineEvent } from "../../src/types.ts";

const authored = minimalAuthored();
const policy = minimalPolicy();

function ev(kind: string, payload: Record<string, unknown>, eventId: string): EngineEvent {
  return { id: eventId, kind, t: { day: 1, minute: 480 }, sid: "s", source: "t", because: [], ...payload } as EngineEvent;
}

test("character.secret_unlocked appends secret id once", () => {
  let s = initialState(authored, policy);
  expect(s.characters.npc1!.unlockedSecrets).toEqual([]);
  s = reduce(s, ev("character.secret_unlocked", { character: "npc1", secret: "heirloom" }, "evt_0001"), policy);
  expect(s.characters.npc1!.unlockedSecrets).toEqual(["heirloom"]);
  s = reduce(s, ev("character.secret_unlocked", { character: "npc1", secret: "heirloom" }, "evt_0002"), policy);
  expect(s.characters.npc1!.unlockedSecrets).toEqual(["heirloom"]);
});

test("character.secret_unlocked on unknown character is a no-op", () => {
  let s = initialState(authored, policy);
  const before = structuredClone(s.characters);
  s = reduce(s, ev("character.secret_unlocked", { character: "nobody", secret: "x" }, "evt_0001"), policy);
  expect(s.characters).toEqual(before);
});
