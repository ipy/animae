const ACCENT_MAP: Record<string, string> = {
  a: "à",
  b: "ƀ",
  c: "ç",
  d: "đ",
  e: "ë",
  f: "ƒ",
  g: "ğ",
  h: "ħ",
  i: "ï",
  j: "ĵ",
  k: "ķ",
  l: "ł",
  m: "ɱ",
  n: "ñ",
  o: "ö",
  p: "þ",
  q: "q",
  r: "ř",
  s: "š",
  t: "ŧ",
  u: "ü",
  v: "ṽ",
  w: "ẅ",
  x: "ẋ",
  y: "ÿ",
  z: "ž",
};

/** en-XA: bracket + accent + ~30% length expansion for untranslated string detection. */
function isPseudoTag(locale: string): boolean {
  const l = locale.toLowerCase();
  return l.startsWith("en-xa") || l === "xx-pseudo" || l.startsWith("xx-pseudo-");
}

export function applyPseudoLocale(text: string, locale: string): string {
  if (!isPseudoTag(locale)) return text;
  let accented = "";
  for (const ch of text) {
    const lower = ch.toLowerCase();
    if (ACCENT_MAP[lower] && ch === lower) accented += ACCENT_MAP[lower];
    else if (ACCENT_MAP[lower] && ch !== lower) accented += ACCENT_MAP[lower]!.toUpperCase();
    else accented += ch;
  }
  const pad = Math.max(1, Math.ceil(accented.length * 0.3));
  return `[${accented}${"·".repeat(pad)}]`;
}

export function isPseudoLocale(locale: string): boolean {
  return isPseudoTag(locale);
}
