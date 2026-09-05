import { test, expect } from "bun:test";
import { MemoryStorage } from "../../src/store/memory.ts";
import { createTimeline } from "../../src/timeline/timeline-store.ts";
import { artifactPath } from "../../src/timeline/paths.ts";
import { memoryJsonlPath } from "../../src/memory/util.ts";
import { minimalAuthored, minimalPolicy, fakeCel } from "./fixture.ts";

test("carry copies post-fork memory lines with carriedFrom", async () => {
  const storage = MemoryStorage();
  const policy = minimalPolicy({
    timeline: {
      allowRewind: true,
      carry: [{ characters: "*", kinds: ["memory"], tags: ["keep"], when: "true" }],
    },
  });
  const tl = createTimeline({
    storage,
    authored: () => minimalAuthored(),
    policy: () => policy,
    cel: fakeCel,
    seed: 1,
    sessionId: "s",
    modelMode: "live",
  });
  await tl.open();
  await tl.append([{ kind: "world.var_set", path: "x", value: 1 }]);
  const forkAt = tl.events().at(-1)!.id;
  await tl.append([{ kind: "world.var_set", path: "marker", value: 0 }]);
  await tl.artifacts.appendJsonl(memoryJsonlPath("npc1"), {
    id: "mem_1",
    kind: "episodic",
    text: "secret",
    tags: ["keep"],
    importance: 0.5,
    valence: 0,
    t: tl.now(),
    branch: "main",
  });
  await tl.append([{ kind: "world.var_set", path: "y", value: 2 }]);
  await tl.rewind(forkAt);
  const rows = await tl.artifacts.readJsonl<{ id: string; carriedFrom?: string; text: string }>(memoryJsonlPath("npc1"));
  expect(rows.some((r) => r.id === "mem_1" && r.carriedFrom?.includes("main"))).toBe(true);
  const parentPath = artifactPath("main", memoryJsonlPath("npc1"));
  expect(await storage.exists(parentPath)).toBe(true);
});
