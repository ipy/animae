/** Optional zh-CN labels for common demo tier names (host games may override via policy UI). */
const DEMO_TIER_ZH: Record<string, string> = {
  distant: "疏远",
  close: "亲近",
  strangers: "陌生",
  acquaintances: "相识",
  friends: "朋友",
};

export function formatTierLabel(tierName: string, language?: string): string {
  if (language?.toLowerCase().startsWith("zh")) {
    return DEMO_TIER_ZH[tierName] ?? tierName;
  }
  return tierName.replace(/_/g, " ");
}

export function formatTrackLabel(trackKey: string, language?: string): string {
  if (language?.toLowerCase().startsWith("zh")) {
    return trackKey;
  }
  return trackKey;
}

/** Heuristic: treat chapter titles with CJK as zh display context. */
export function inferZhLanguage(chapter: unknown): boolean {
  if (typeof chapter !== "string") return false;
  return /[\u4e00-\u9fff]/.test(chapter);
}
