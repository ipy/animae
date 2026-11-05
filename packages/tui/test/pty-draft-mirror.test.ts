import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mirrorPtyInputDraft, mirrorPtyTurnPending } from "../src/input/pty-draft-mirror.ts";

describe("pty draft mirror", () => {
  let dir: string;
  let file: string;
  const saved = process.env.TUI_PTY_DRAFT_FILE;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tui-draft-"));
    file = join(dir, "draft.txt");
    process.env.TUI_PTY_DRAFT_FILE = file;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (saved === undefined) delete process.env.TUI_PTY_DRAFT_FILE;
    else process.env.TUI_PTY_DRAFT_FILE = saved;
  });

  test("mirrors draft, cursor, and pending flag", () => {
    mirrorPtyTurnPending(true);
    mirrorPtyInputDraft("hello", 3);
    const raw = readFileSync(file, "utf8");
    expect(raw).toBe("hello\n3\n1\n");
    mirrorPtyTurnPending(false);
    const raw2 = readFileSync(file, "utf8");
    expect(raw2).toBe("hello\n3\n0\n");
  });
});
