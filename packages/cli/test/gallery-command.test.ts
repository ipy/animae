import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { runInit } from "../src/commands/init.ts";
import { runGallery } from "../src/commands/gallery.ts";
import { withCapturedStdout } from "./helpers/io.ts";

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "animae-gallery-cmd-"));
  await runInit({ dir, preset: "@animae/preset-rule" });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const opts = () => ({ root: dir, mode: "rule" as const, lang: "en" });

test("gallery list empty and ratings", async () => {
  const list = await withCapturedStdout(() => runGallery("list", ["--all"], opts()));
  expect(list.code).toBe(0);
  expect(list.out.length).toBeGreaterThan(0);

  const json = await withCapturedStdout(() => runGallery("ratings", [], { ...opts(), json: true }));
  expect(json.code).toBe(0);
  expect(() => JSON.parse(json.out)).not.toThrow();
});

test("gallery capture fails with GALLERY_NO_MODEL in rule mode", async () => {
  const { code, err } = await withCapturedStdout(() => runGallery("capture", [], opts()));
  expect(code).toBe(1);
  expect(err).toMatch(/GALLERY_NO_MODEL|gallery/i);
});

test("gallery usage errors", async () => {
  expect(await withCapturedStdout(() => runGallery("show", [], opts())).then((r) => r.code)).toBe(1);
  expect(await withCapturedStdout(() => runGallery("render", [], opts())).then((r) => r.code)).toBe(1);
  expect(await withCapturedStdout(() => runGallery("nope", [], opts())).then((r) => r.code)).toBe(1);
});

test("gallery show not found and render usage", async () => {
  const show = await withCapturedStdout(() => runGallery("show", ["missing-item"], opts()));
  expect(show.code).toBe(1);
  expect(show.err.length).toBeGreaterThan(0);

  const render = await withCapturedStdout(() => runGallery("render", ["missing-item"], opts()));
  expect(render.code).toBe(1);
});

test("gallery jobs json and capture json error body", async () => {
  const jobs = await withCapturedStdout(() => runGallery("jobs", [], { ...opts(), json: true }));
  expect(jobs.code).toBe(0);
  expect(() => JSON.parse(jobs.out)).not.toThrow();

  const cap = await withCapturedStdout(() => runGallery("capture", [], { ...opts(), json: true }));
  expect(cap.code).toBe(1);
  expect(cap.err.length).toBeGreaterThan(0);
});

test("gallery openEngine failure on bad root", async () => {
  const missing = await mkdtemp(join(tmpdir(), "animae-gallery-del-"));
  await rm(missing, { recursive: true, force: true });
  const { code, err } = await withCapturedStdout(() => runGallery("list", [], { root: missing, mode: "rule" }));
  expect(code).toBe(1);
  expect(err.length).toBeGreaterThan(0);
});
