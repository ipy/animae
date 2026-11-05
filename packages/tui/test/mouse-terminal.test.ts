import { describe, expect, test, afterEach } from "bun:test";
import { PassThrough } from "node:stream";
import {
  MOUSE_MODE_OFF,
  MOUSE_MODE_ON,
  MOUSE_MODE_ON_HOVER,
  installGlobalMouseCleanup,
  registerMouseTerminalCleanup,
  resolveMouseEnabled,
  writeMouseMode,
} from "../src/input/mouse-terminal.ts";

describe("mouse-terminal", () => {
  const savedNoMouse = process.env.NO_MOUSE;

  afterEach(() => {
    if (savedNoMouse === undefined) delete process.env.NO_MOUSE;
    else process.env.NO_MOUSE = savedNoMouse;
  });

  test("writeMouseMode emits SGR sequences", () => {
    const chunks: string[] = [];
    const stdout = Object.assign(new PassThrough(), {
      write: (s: string) => {
        chunks.push(s);
        return true;
      },
    }) as NodeJS.WritableStream;
    writeMouseMode(stdout, "off");
    expect(chunks.join("")).toBe(MOUSE_MODE_OFF);
    chunks.length = 0;
    writeMouseMode(stdout, "basic");
    expect(chunks.join("")).toBe(MOUSE_MODE_ON);
    chunks.length = 0;
    writeMouseMode(stdout, "hover");
    expect(chunks.join("")).toContain(MOUSE_MODE_ON_HOVER);
  });

  test("resolveMouseEnabled respects NO_MOUSE and explicit false", () => {
    process.env.NO_MOUSE = "1";
    expect(resolveMouseEnabled({ mouse: true })).toEqual({ enabled: false, hover: false });
    delete process.env.NO_MOUSE;
    expect(resolveMouseEnabled({ mouse: false })).toEqual({ enabled: false, hover: false });
  });

  test("registerMouseTerminalCleanup and global cleanup write off on TTY stdout", () => {
    const written: string[] = [];
    const stdout = Object.assign(new PassThrough(), {
      isTTY: true,
      write: (chunk: string) => {
        written.push(chunk);
        return true;
      },
    }) as PassThrough & { isTTY: boolean };
    const off = registerMouseTerminalCleanup(() => written.push("cleanup"));
    off();
    const uninstall = installGlobalMouseCleanup(stdout);
    uninstall();
    expect(written.some((w) => w.includes(MOUSE_MODE_OFF) || w === MOUSE_MODE_OFF)).toBe(true);
  });
});
