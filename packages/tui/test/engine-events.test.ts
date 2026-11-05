import { describe, expect, test } from "bun:test";
import { notifyTimelineNavigated, subscribeQueryChanges } from "../src/utils/engine-events.ts";
import { createTuiFakeEngineControls } from "./helpers/fake-engine.ts";

describe("subscribeQueryChanges", () => {
  test("calls back on an event a query depends on and when the timeline is navigated, until unsubscribed", () => {
    const { engine, emit } = createTuiFakeEngineControls();
    let calls = 0;
    const off = subscribeQueryChanges(engine, () => {
      calls += 1;
    });
    emit("time.advanced");
    expect(calls).toBe(1);
    notifyTimelineNavigated(engine);
    expect(calls).toBe(2);
    emit("memory.written"); // no query shows memories
    expect(calls).toBe(2);

    off();
    emit("time.advanced");
    notifyTimelineNavigated(engine);
    expect(calls).toBe(2);
  });

  test("a navigation reaches the subscribers of that engine only", () => {
    const a = createTuiFakeEngineControls().engine;
    const b = createTuiFakeEngineControls().engine;
    const seen: string[] = [];
    const offA = subscribeQueryChanges(a, () => void seen.push("a"));
    const offB = subscribeQueryChanges(b, () => void seen.push("b"));
    notifyTimelineNavigated(b);
    expect(seen).toEqual(["b"]);
    notifyTimelineNavigated(a);
    expect(seen).toEqual(["b", "a"]);
    offA();
    offB();
  });

  test("announcing a navigation on an engine nobody watches is harmless", () => {
    expect(() => notifyTimelineNavigated(createTuiFakeEngineControls().engine)).not.toThrow();
  });
});
