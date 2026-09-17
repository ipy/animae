import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

/** When set, mirror input draft for external PTY harnesses (stdout is not linear). */
const DRAFT_FILE = process.env.TUI_PTY_DRAFT_FILE?.trim() || "";

let harnessPending = false;

export function mirrorPtyTurnPending(pending: boolean): void {
  harnessPending = pending;
  if (!DRAFT_FILE) return;
  try {
    const prev = readHarnessMirror();
    writeFileSync(
      DRAFT_FILE,
      `${prev.draft}\n${prev.cursor}\n${pending ? 1 : 0}\n`,
      "utf8",
    );
  } catch {
    /* ignore */
  }
}

function readHarnessMirror(): { draft: string; cursor: number; pending: boolean } {
  if (!DRAFT_FILE) return { draft: "", cursor: 0, pending: false };
  try {
    const raw = readFileSync(DRAFT_FILE, "utf8");
    const lines = raw.split("\n");
    return {
      draft: lines[0] ?? "",
      cursor: Number(lines[1]) || 0,
      pending: lines[2] === "1",
    };
  } catch {
    return { draft: "", cursor: 0, pending: harnessPending };
  }
}

export function mirrorPtyInputDraft(draft: string, cursor: number): void {
  if (!DRAFT_FILE) return;
  try {
    writeFileSync(DRAFT_FILE, `${draft}\n${cursor}\n${harnessPending ? 1 : 0}\n`, "utf8");
  } catch {
    try {
      appendFileSync(DRAFT_FILE, "");
    } catch {
      /* ignore */
    }
  }
}
