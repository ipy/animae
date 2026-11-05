import { defaultTheme } from "../../src/theme/defaults.ts";
import type { CueCtx } from "../../src/types.ts";

export function testCueCtx(overrides: Partial<CueCtx> = {}): CueCtx {
  return {
    theme: defaultTheme,
    visibleChars: 0,
    totalChars: 0,
    ...overrides,
  };
}
