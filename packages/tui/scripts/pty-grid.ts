/** Strip ANSI and collapse to a fixed-size character grid (best-effort for snapshots). */
export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, "");
}

export function gridFromAnsi(raw: string, cols: number, rows: number): string {
  const plain = stripAnsi(raw);
  const lines = plain.split(/\r?\n/);
  const body = lines.slice(-rows - 2);
  const grid: string[] = [];
  for (let r = 0; r < rows; r++) {
    const line = body[r] ?? "";
    grid.push(line.padEnd(cols, " ").slice(0, cols));
  }
  return `${grid.join("\n")}\n`;
}
