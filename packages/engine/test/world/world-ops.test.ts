import { expect, test } from "bun:test";
import { AnimaeError } from "../../src/types.ts";
import { createFakeKernel } from "./fake-kernel.ts";

test("world.set validates path and schema extension", async () => {
  const fk = createFakeKernel({
    policyLayer: { schema: { extend: { world: { mood: { type: "number", min: 0, max: 1 } } } } },
  });
  await fk.world.set("mood", 0.5);
  expect(fk.state().vars.mood).toBe(0.5);
  await expect(fk.world.set("mood", 2)).rejects.toThrow(AnimaeError);
  await expect(fk.world.set("  ", 1)).rejects.toThrow(AnimaeError);
});

test("world.move rejects unknown location", async () => {
  const fk = createFakeKernel();
  await expect(fk.world.move("npc", "nowhere")).rejects.toThrow(AnimaeError);
  await fk.world.move("npc", "tavern");
  expect(fk.state().characters.npc?.location).toBe("tavern");
});

test("advance rejects backwards time", async () => {
  const fk = createFakeKernel();
  await expect(fk.world.advance({ to: { day: 1, minute: 0 } })).rejects.toThrow(AnimaeError);
});

test("advance emits single time.advanced per call", async () => {
  const fk = createFakeKernel({
    schedule: [{ id: "a", every: "hour", emit: { kind: "tick" } }],
  });
  await fk.world.advance("2h");
  const advanced = fk.events().filter((e) => e.kind === "time.advanced");
  expect(advanced).toHaveLength(1);
});
