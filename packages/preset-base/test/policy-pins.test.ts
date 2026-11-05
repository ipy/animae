import { expect, test } from "bun:test";
import { loadBasePolicy } from "./helpers.ts";

test("preset-base memory.weights.vector is opt-in zero", async () => {
  const policy = await loadBasePolicy();
  const weights = policy.memory.weights;
  expect(weights).toBeDefined();
  if (weights === undefined) return;
  expect(weights.vector).toBe(0);
});

test("preset-base router triggers are enabled with mood track default", async () => {
  const policy = await loadBasePolicy();
  const triggers = policy.router.triggers;
  expect(triggers).toBeDefined();
  if (triggers === undefined) return;
  expect(triggers.anchor_near?.enabled).toBe(true);
  expect(triggers.secret_topic?.enabled).toBe(true);
  expect(triggers.mood_spike).toMatchObject({ enabled: true, track: "mood" });
  const degrade = policy.router.degrade;
  expect(degrade).toBeDefined();
  if (degrade === undefined) return;
  expect(degrade.length).toBeGreaterThan(0);
});

test("preset-base visibility grants player event kinds only", async () => {
  const policy = await loadBasePolicy();
  const playerEvents = policy.visibility.rules.find((r) => r.viewer === "player" && r.path === "events");
  expect(playerEvents?.kinds).toContain("utterance");
  expect(playerEvents?.kinds).toContain("input.received");
  const authorWorld = policy.visibility.rules.some((r) => r.viewer === "author" && r.path === "world");
  expect(authorWorld).toBe(true);
});
