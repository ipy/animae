import { registerLocalePack } from "@animae/i18n";

/** Partial French TUI pack for tier/track label tests. */
export function registerFrenchTuiLocalePack(): () => void {
  return registerLocalePack({
    locale: "fr",
    catalogs: {
      tui: {
        tiers: {
          close: "proche",
        },
        tracks: {
          bond: "lien",
        },
      },
    },
  });
}
