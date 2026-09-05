/** Router budget slice used in router/pipeline tests (matches policy loader defaults). */
export const testRouterBudget = {
  syncCallsPerTurn: 2,
  s2PerTurn: 1,
  s2Ratio: 0.15,
  s2ReservedForAnchors: 0.03,
  maxOutputTokens: { s1: 400, s2: 800 },
  sceneS2Pool: 4,
} as const;

export const testBudgetState = {
  turns: 0,
  s2Turns: 0,
  s2Scene: 0,
  degraded: [] as string[],
};
