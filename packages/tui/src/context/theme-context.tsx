import { createContext, useContext, type ReactNode } from "react";
import type { Theme } from "../types.ts";
import { defaultTheme } from "../theme/defaults.ts";

const ThemeContext = createContext<Theme>(defaultTheme);

export function ThemeProvider({ theme, children }: { theme: Theme; children: ReactNode }) {
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useThemeContext(): Theme {
  return useContext(ThemeContext);
}
