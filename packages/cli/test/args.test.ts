import { test, expect } from "bun:test";
import { parseCli } from "../src/args.ts";

test("parseCli help", () => {
  expect(parseCli(["--help"]).kind).toBe("help");
});

test("parseCli init with preset", () => {
  const p = parseCli(["init", "./world", "--preset", "@animae/preset-base"]);
  expect(p.kind).toBe("init");
  if (p.kind === "init") {
    expect(p.dir).toBe("./world");
    expect(p.preset).toBe("@animae/preset-base");
  }
});

test("parseCli serve requires stdio", () => {
  expect(() => parseCli(["serve"])).toThrow(/stdio/);
  expect(parseCli(["--root", "/tmp", "serve", "--stdio"]).kind).toBe("serve");
});

test("parseCli validate accepts global flags after command", () => {
  const p = parseCli(["validate", "--root", "/tmp/data"]);
  expect(p.kind).toBe("validate");
  if (p.kind === "validate") expect(p.global.root).toBe("/tmp/data");
});

test("parseCli run plain flag", () => {
  const p = parseCli(["run", "--plain", "--scene", "tavern"]);
  expect(p.kind).toBe("run");
  if (p.kind === "run") {
    expect(p.plain).toBe(true);
    expect(p.scene).toBe("tavern");
  }
});
