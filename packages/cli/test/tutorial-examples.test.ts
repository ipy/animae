import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test, expect } from "bun:test";
import { runValidate } from "../src/commands/validate.ts";
import { tutorialFixtureSrc as tutorialRoot } from "./helpers/fixture-copy.ts";

/** Files the authoring guide names in its tutorial layout; all ship with the repository. */
const pathsFromAuthoringGuide = [
  "animae.yaml",
  "world/world.yaml",
  "world/anchors.yaml",
  "world/beats.yaml",
  "world/exceptions.yaml",
  "world/schedule.yaml",
  "world/locations/home.yaml",
  "world/locations/market.yaml",
  "world/items/map.yaml",
  "world/fields/welcome-boost.yaml",
  "world/knowledge/market-rules.md",
  "characters/player/card.md",
  "characters/player/traits.yaml",
  "characters/player/tracks.yaml",
  "characters/guide/card.md",
  "policies/tutorial.yaml",
  "templates/character/stranger.yaml",
];

/** Relative path → content of every file under `root`, so a run can prove it neither added nor changed one. */
async function snapshotTree(root: string, dir = root, out = new Map<string, string>()): Promise<Map<string, string>> {
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await snapshotTree(root, full, out);
    else out.set(full.slice(root.length + 1), await readFile(full, "utf8"));
  }
  return out;
}

test("validating the tutorial tree in place leaves it untouched (no gallery/ or timelines/)", async () => {
  const before = await snapshotTree(tutorialRoot);
  expect(before.has("animae.yaml")).toBe(true);

  expect(await runValidate(tutorialRoot)).toBe(0);
  expect(await runValidate(tutorialRoot, undefined, undefined, "rule")).toBe(0);

  const after = await snapshotTree(tutorialRoot);
  expect([...after.keys()]).toEqual([...before.keys()]);
  expect(after).toEqual(before);
});

test("authoring-guide example paths exist under docs/examples/tutorial", async () => {
  for (const rel of pathsFromAuthoringGuide) {
    await access(join(tutorialRoot, rel));
  }
});
