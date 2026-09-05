export function hasVerbatimEcho(noteText: string, generated: string, minRun = 8): boolean {
  const normalized = noteText.trim();
  if (normalized.length < minRun) return false;
  for (let len = normalized.length; len >= minRun; len--) {
    for (let i = 0; i + len <= normalized.length; i++) {
      const slice = normalized.slice(i, i + len);
      if (generated.includes(slice)) return true;
    }
  }
  return false;
}
