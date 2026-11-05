import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { runInit } from "../src/commands/init.ts";
import { runInspect } from "../src/commands/inspect.ts";
import { openEngine } from "../src/engine-open.ts";
import { withCapturedStdout } from "./helpers/io.ts";

test("inspect events --kind filters narration rows", async () => {
  const dir = await mkdtemp(join(tmpdir(), "animae-inspect-filter-"));
  try {
    await runInit({ dir, preset: "@animae/preset-rule" });
    const engine = await openEngine({ root: dir, mode: "rule" });
    try {
      const sceneId = await engine.scene.start({ location: "home", participants: ["player"] });
      for await (const _ of engine.scene.turn({ sceneId, actor: "player", text: "hi" })) {
        /* drain */
      }
    } finally {
      await engine.close();
    }
    const { code, out } = await withCapturedStdout(() =>
      runInspect({ root: dir, path: "events", viewer: "debug", eventKind: "narration", mode: "rule" }),
    );
    expect(code).toBe(0);
    const rows = JSON.parse(out) as { kind: string }[];
    expect(Array.isArray(rows)).toBe(true);
    for (const row of rows) expect(row.kind).toBe("narration");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
