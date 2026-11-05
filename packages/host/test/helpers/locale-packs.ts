import { registerLocalePack } from "@animae/i18n";

/** Partial French host catalog for host-i18n and gallery notice locale tests. */
export function registerFrenchHostLocalePack(): () => void {
  return registerLocalePack({
    locale: "fr",
    catalogs: {
      host: {
        command: {
          load_ui_hint: "Ouvrez l'interface de chargement ou indiquez le nom du slot",
        },
      },
    },
  });
}
