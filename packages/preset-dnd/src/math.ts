/** D&D ability modifier: floor((score − 10) / 2), including negative scores (spec §19.5). */
export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/** Proficiency bonus by character level (SRD 5.2.1). */
export function proficiencyBonus(level: number): number {
  const l = Math.max(1, Math.min(20, Math.floor(level)));
  return 2 + Math.floor((l - 1) / 4);
}

export const SKILL_ABILITIES: Record<string, keyof typeof DEFAULT_ABILITIES> = {
  acrobatics: "DEX",
  animal_handling: "WIS",
  arcana: "INT",
  athletics: "STR",
  deception: "CHA",
  history: "INT",
  insight: "WIS",
  intimidation: "CHA",
  investigation: "INT",
  medicine: "WIS",
  nature: "INT",
  perception: "WIS",
  performance: "CHA",
  persuasion: "CHA",
  religion: "INT",
  sleight_of_hand: "DEX",
  stealth: "DEX",
  survival: "WIS",
};

export const DEFAULT_ABILITIES = { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 } as const;

export function skillModifier(
  skill: string,
  abilities: Record<string, number>,
  level: number,
  proficiencies: string[],
): number {
  const ab = SKILL_ABILITIES[skill];
  if (!ab) return 0;
  const score = abilities[ab] ?? 10;
  const mod = abilityModifier(score);
  const prof = proficiencies.includes(skill) ? proficiencyBonus(level) : 0;
  return mod + prof;
}
