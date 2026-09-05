import type { Theme } from "../types.ts";

export const defaultTheme: Theme = {
  colors: {
    primary: "cyan",
    npc: "magenta",
    player: "green",
    narration: "gray",
    warning: "yellow",
    dim: "gray",
    border: "gray",
  },
  border: "round",
  typewriter: { charsPerSecond: 60, enabled: true },
  sidePanel: {
    widthPercent: 30,
    show: ["participants", "tracks", "fields", "anchor"],
  },
  bell: false,
};
