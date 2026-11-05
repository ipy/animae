import { registerLocalePack } from "@animae/i18n";

/** Partial French pack for SessionRoom / host+web snapshot and error localization tests. */
export function registerFrenchSessionLocalePack(): () => void {
  return registerLocalePack({
    locale: "fr",
    catalogs: {
      host: {
        header: {
          time_label: "Jour {day} {time}",
        },
        error: {
          no_scene: "Aucune scène active",
        },
      },
      web: {
        error: {
          read_only: "Les spectateurs ne peuvent pas contrôler la session",
        },
      },
    },
  });
}

/** Registers a `web-client` pack (full or partial) for ref-client / API tests. */
export function registerFrenchWebClientPack(catalog: Record<string, string>): () => void {
  return registerLocalePack({
    locale: "fr",
    catalogs: { "web-client": catalog },
  });
}
