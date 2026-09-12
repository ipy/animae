import { appendFileSync, writeFileSync } from "node:fs";

/** When set, mirror input draft for external PTY harnesses (stdout is not linear). */
const DRAFT_FILE = process.env.TUI_PTY_DRAFT_FILE?.trim() || "";

export function mirrorPtyInputDraft(draft: string, cursor: number): void {
  if (!DRAFT_FILE) return;
  try {
    writeFileSync(DRAFT_FILE, `${draft}\n${cursor}\n`, "utf8");
  } catch {
    try {
      appendFileSync(DRAFT_FILE, "");
    } catch {
      /* ignore */
    }
  }
}
