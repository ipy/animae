import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

/** When set, mirror input draft for external PTY harnesses (stdout is not linear). */
function draftFilePath(): string {
  return process.env.TUI_PTY_DRAFT_FILE?.trim() || "";
}

let harnessPending = false;

export function mirrorPtyTurnPending(pending: boolean): void {
  harnessPending = pending;
  const file = draftFilePath();
  if (!file) return;
  try {
    const prev = readHarnessMirror();
    writeFileSync(
      file,
      `${prev.draft}\n${prev.cursor}\n${pending ? 1 : 0}\n`,
      "utf8",
    );
  } catch {
    /* ignore */
  }
}

function readHarnessMirror(): { draft: string; cursor: number; pending: boolean } {
  const file = draftFilePath();
  if (!file) return { draft: "", cursor: 0, pending: false };
  try {
    const raw = readFileSync(file, "utf8");
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
  const file = draftFilePath();
  if (!file) return;
  try {
    writeFileSync(file, `${draft}\n${cursor}\n${harnessPending ? 1 : 0}\n`, "utf8");
  } catch {
    try {
      appendFileSync(file, "");
    } catch {
      /* ignore */
    }
  }
}
