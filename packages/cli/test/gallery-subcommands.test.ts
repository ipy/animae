import { chmod, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { createScriptedModel } from "../../engine/src/model/scripted.ts";
import { e2ePreset } from "../../engine/test/e2e/fixture.ts";
import { runGallery } from "../src/commands/gallery.ts";
import { createGallerySeedRoot } from "./helpers/gallery-seed-root.ts";
import { withCapturedStdout } from "./helpers/io.ts";

const MIN_PNG_SH = `#!/bin/sh
cat >/dev/null
printf '\\x89PNG\\r\\n\\x1a\\n\\0\\0\\0\\0\\0\\0\\0\\0\\0\\0\\0\\0\\0\\0\\0\\0\\0\\0\\0\\0'
`;

let dir = "";
let imageScript = "";

afterEach(async () => {
  if (dir) {
    await rm(dir, { recursive: true, force: true });
    dir = "";
  }
});

async function galleryOpts(extra: Record<string, unknown> = {}) {
  dir = await createGallerySeedRoot();
  imageScript = join(dir, "img.sh");
  await writeFile(imageScript, MIN_PNG_SH);
  await chmod(imageScript, 0o755);
  const brief = {
    title: "Quiet moment",
    caption: "A pause.",
    prompt: "two friends at a tavern table, warm light",
    characters: [{ name: "Player" }, { name: "Aria" }],
  };
  const model = createScriptedModel("m/s1", (req) => {
    if (req.label === "cg_brief") return brief;
    return { text: "ok" };
  });
  return {
    root: dir,
    presets: [e2ePreset],
    models: { s1: model, s2: model },
    imageCommand: imageScript,
    lang: "en" as const,
    ...extra,
  };
}

test("gallery list tabular output and list json", async () => {
  const opts = await galleryOpts();
  const tab = await withCapturedStdout(() => runGallery("list", ["--all"], opts));
  expect(tab.code).toBe(0);
  expect(tab.out).toMatch(/dawn-greenhouse/);

  const json = await withCapturedStdout(() => runGallery("list", ["--all"], { ...opts, json: true }));
  expect(json.code).toBe(0);
  const items = JSON.parse(json.out) as { id: string }[];
  expect(items.some((i) => i.id === "dawn-greenhouse")).toBe(true);
});

test("gallery show text and json after unlock", async () => {
  const opts = await galleryOpts();
  const { openEngine } = await import("../src/engine-open.ts");
  const engine = await openEngine(opts);
  await engine.gallery.unlock("dawn-greenhouse", { source: "test" });
  await engine.close();

  const text = await withCapturedStdout(() => runGallery("show", ["dawn-greenhouse"], opts));
  expect(text.code).toBe(0);
  expect(text.out).toContain("Dawn");

  const json = await withCapturedStdout(() => runGallery("show", ["dawn-greenhouse"], { ...opts, json: true }));
  expect(json.code).toBe(0);
  expect(JSON.parse(json.out).id).toBe("dawn-greenhouse");
});

test("gallery ratings and jobs plain output", async () => {
  const opts = await galleryOpts();
  const ratings = await withCapturedStdout(() => runGallery("ratings", [], opts));
  expect(ratings.code).toBe(0);
  expect(ratings.out).toMatch(/general/);

  const jobs = await withCapturedStdout(() => runGallery("jobs", [], opts));
  expect(jobs.code).toBe(0);
});

test("gallery capture and render success messages", async () => {
  const opts = await galleryOpts();
  const { openEngine } = await import("../src/engine-open.ts");
  const engine = await openEngine(opts);
  await engine.gallery.unlock("dawn-greenhouse", { source: "test" });
  await engine.close();

  const cap = await withCapturedStdout(() => runGallery("capture", ["focus", "scene"], opts));
  expect(cap.code).toBe(0);
  expect(cap.out).toMatch(/capture|job/i);

  const capJson = await withCapturedStdout(() => runGallery("capture", [], { ...opts, json: true }));
  expect(capJson.code).toBe(0);
  expect(JSON.parse(capJson.out).job).toMatch(/^job_/);

  const render = await withCapturedStdout(() =>
    runGallery("render", ["dawn-greenhouse", "--reroll"], opts),
  );
  expect(render.code).toBe(0);
  expect(render.out.length).toBeGreaterThan(0);

  const renderJson = await withCapturedStdout(() =>
    runGallery("render", ["dawn-greenhouse"], { ...opts, json: true }),
  );
  expect(renderJson.code).toBe(0);
});

test("gallery cancel remove pin and no_job", async () => {
  const opts = await galleryOpts();
  const capJson = await withCapturedStdout(() => runGallery("capture", [], { ...opts, json: true }));
  expect(capJson.code).toBe(0);
  const capturedId = JSON.parse(capJson.out).item as string;

  const cancel = await withCapturedStdout(() => runGallery("cancel", [], opts));
  expect(cancel.code).toBe(0);

  const cap2 = await withCapturedStdout(() => runGallery("capture", [], { ...opts, json: true }));
  expect(cap2.code).toBe(0);
  const capturedId2 = JSON.parse(cap2.out).item as string;

  const pin = await withCapturedStdout(() => runGallery("pin", [capturedId2], opts));
  expect(pin.code).toBe(0);
  expect(pin.out.length).toBeGreaterThan(0);

  const unpin = await withCapturedStdout(() => runGallery("pin", [capturedId2, "--unpin"], opts));
  expect(unpin.code).toBe(0);

  const remove = await withCapturedStdout(() => runGallery("remove", [capturedId], opts));
  expect(remove.code).toBe(0);
  expect(remove.out.length).toBeGreaterThan(0);

  const noJob = await withCapturedStdout(() => runGallery("cancel", ["job_never_exists"], opts));
  expect(noJob.code).toBe(0);
});

test("gallery remove pin usage and unknown subcommand help", async () => {
  const opts = await galleryOpts();
  expect(await withCapturedStdout(() => runGallery("remove", [], opts)).then((r) => r.code)).toBe(1);
  expect(await withCapturedStdout(() => runGallery("pin", [], opts)).then((r) => r.code)).toBe(1);

  const unknown = await withCapturedStdout(() => runGallery("bogus", [], opts));
  expect(unknown.code).toBe(1);
  expect(unknown.err).toContain("Unknown gallery subcommand");
});
