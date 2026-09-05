/** Lilium policy tier names → zh-CN labels (player-visible tiers only). */
const LILIUM_TIER_ZH: Record<string, string> = {
  defiant: "抗拒",
  doubtful: "疑虑",
  accepting: "认可",
  loyal: "忠诚",
  devoted: "死忠",
  breaking: "崩溃",
  fragile: "动摇",
  steady: "平稳",
  serene: "安宁",
  strangers: "陌生",
  acquaintances: "相识",
  friends: "朋友",
  close: "亲密",
  partners: "伴侣",
};

const LILIUM_TRACK_ZH: Record<string, string> = {
  authority: "威信",
  stability: "稳定",
  bond: "羁绊",
  trust: "信任",
};

export function formatTierLabel(tierName: string, language?: string): string {
  if (language?.toLowerCase().startsWith("zh")) {
    return LILIUM_TIER_ZH[tierName] ?? tierName;
  }
  return tierName.replace(/_/g, " ");
}

export function formatTrackLabel(trackKey: string, language?: string): string {
  if (language?.toLowerCase().startsWith("zh")) {
    return LILIUM_TRACK_ZH[trackKey] ?? trackKey;
  }
  return trackKey;
}

/** Heuristic: Lilium data uses zh-CN chapter titles in queries. */
export function inferZhLanguage(chapter: unknown): boolean {
  if (typeof chapter !== "string") return false;
  return /[\u4e00-\u9fff]/.test(chapter);
}
