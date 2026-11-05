import { registerLocalePack } from "@animae/i18n";

/** French UI strings for PTY locale harness (side panel chrome + :lang feedback). */
export function registerPtyFrenchLocalePack(): () => void {
  return registerLocalePack({
    locale: "fr",
    catalogs: {
      tui: {
        side_panel: {
          title: "Panneau latéral",
          participants: "Personnes",
          tracks: "Pistes",
          beat_anchors: "Beat / repères",
        },
        help: {
          title: "Aide (F1)",
        },
        field_list: {
          empty: "Aucun champ visible",
        },
        too_small: {
          title: "Agrandissez le terminal",
        },
        command: {
          lang_set: "Langue définie sur {locale}",
        },
      },
    },
  });
}
