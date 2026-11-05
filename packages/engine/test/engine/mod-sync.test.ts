import { expect, test } from "bun:test";
import { modRecordFromResolved, syncModTimelineRecord, emitInitialModConfig } from "../../src/engine/mod-sync.ts";
import { buildTestKernel } from "../helpers/fake-kernel.ts";
import { minimalAuthored } from "../helpers/fake-kernel.ts";

test("modRecordFromResolved maps resolved mods", () => {
  const rows = modRecordFromResolved([{ id: "m1", version: "1.0.0", contentHash: "abc", path: "mods/m1" } as never]);
  expect(rows).toEqual([{ id: "m1", version: "1.0.0", contentHash: "abc" }]);
});

test("syncModTimelineRecord emits mod_drift warning when records differ", async () => {
  const k = buildTestKernel(minimalAuthored());
  await syncModTimelineRecord(k, [{ id: "m1", version: "2", contentHash: "x", path: "p" } as never], [
    { id: "m1", version: "1", contentHash: "y" },
  ]);
  expect(k.timeline.events().some((e) => e.kind === "config.warning" && (e as { code?: string }).code === "mod_drift")).toBe(true);
});

test("emitInitialModConfig writes config.reloaded when drift or empty record", async () => {
  const k = buildTestKernel(minimalAuthored());
  await emitInitialModConfig(k, "hash1", [{ id: "m1", version: "1", contentHash: "h", path: "p" } as never], undefined);
  expect(k.timeline.events().some((e) => e.kind === "config.reloaded")).toBe(true);
});
