/** Simple fuzzy subsequence matcher for command palette (ASCII + CJK friendly). */

export function fuzzyScore(query: string, text: string): number | undefined {
  const q = query.trim().toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;
  if (t.includes(q)) return 100 - t.indexOf(q);
  let qi = 0;
  let score = 0;
  let last = -1;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += 10;
      if (last >= 0 && ti === last + 1) score += 5;
      last = ti;
      qi++;
    }
  }
  if (qi < q.length) return undefined;
  return score;
}

export function fuzzyRank<T>(query: string, items: T[], label: (item: T) => string): T[] {
  const scored: Array<{ item: T; score: number }> = [];
  for (const item of items) {
    const s = fuzzyScore(query, label(item));
    if (s !== undefined) scored.push({ item, score: s });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.item);
}
