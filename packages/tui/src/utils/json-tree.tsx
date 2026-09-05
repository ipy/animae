import { Box, Text } from "ink";

export function JsonTree({
  value,
  maxDepth = 4,
}: {
  value: unknown;
  maxDepth?: number;
}) {
  const lines = flattenJson(value, 0, maxDepth);
  return (
    <Box flexDirection="column">
      {lines.map((line, i) => (
        <Text key={i}>{line}</Text>
      ))}
    </Box>
  );
}

function flattenJson(value: unknown, depth: number, maxDepth: number): string[] {
  const pad = "  ".repeat(depth);
  if (depth > maxDepth) return [`${pad}…`];
  if (value === null || value === undefined) return [`${pad}${String(value)}`];
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return [`${pad}${JSON.stringify(value)}`];
  }
  if (Array.isArray(value)) {
    const lines = [`${pad}[`];
    for (const v of value.slice(0, 10)) {
      lines.push(...flattenJson(v, depth + 1, maxDepth));
    }
    if (value.length > 10) lines.push(`${pad}  … (${value.length} items)`);
    lines.push(`${pad}]`);
    return lines;
  }
  if (typeof value === "object") {
    const lines = [`${pad}{`];
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 14)) {
      lines.push(`${pad}  ${k}:`);
      lines.push(...flattenJson(v, depth + 2, maxDepth));
    }
    lines.push(`${pad}}`);
    return lines;
  }
  return [`${pad}${String(value)}`];
}
