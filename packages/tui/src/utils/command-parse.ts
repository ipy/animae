export interface ParsedCommand {
  name: string;
  args: string[];
  raw: string;
}

export function parseColonCommand(line: string): ParsedCommand | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith(":")) return undefined;
  const body = trimmed.slice(1).trim();
  if (!body) return { name: "help", args: [], raw: trimmed };
  const parts = body.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  const unquote = (s: string) =>
    (s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))
      ? s.slice(1, -1)
      : s;
  const name = unquote(parts[0] ?? "").toLowerCase();
  const args = parts.slice(1).map(unquote);
  return { name, args, raw: trimmed };
}
