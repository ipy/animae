import { registerLocalePack, type LocaleNamespace } from "@animae/i18n";
import type { MessageCatalog } from "@animae/i18n";

/** Primary neutral test locale for prompt-catalog scenarios (partial pack over English). */
export const FR_TEST_LOCALE = "fr";

/** Regional variant used when tests need locale-chain / variant behavior. */
export const FR_CA_TEST_LOCALE = "fr-CA";

const frenchPromptSections: Record<string, string> = {
  tool_search_description:
    "Recherchez dans les souvenirs et la connaissance du monde de ce personnage par mots-clés ; renvoie de courts extraits avec leurs identifiants.",
  tool_read_description:
    "Charge le corps complet d'un document de connaissance par identifiant (depuis la recherche ou l'index).",
  memory_hit_hazy: "(Souvenir flou : {distortion}) ",
  memory_distortion_intensify:
    "vous vous en souvenez avec plus d'intensité émotionnelle et de certitude qu'il ne le mérite",
  appraise_type_line: "- {id} : {text}{positive}",
  appraise_type_positive: " [positif]",
  appraise_type_text: "{label} — {description}",
  name_glossary:
    "Glossaire des noms — dans la sortie {tag}, écrivez ces noms exactement comme à droite :\n{rows}",
  render_user:
    "Générez la réponse incarnée de {name} pour ce tour. Parlez uniquement en tant que {name} ; ne parlez jamais pour quelqu'un d'autre.",
  render_user_language: "Rédigez le texte visible par le joueur en {language} ({tag}).",
  heading_recalled: "Souvenirs et connaissances rappelés :",
};

/**
 * Registers a partial French `prompts` catalog (plus optional namespace overrides) for pipeline / engine tests.
 * Always call the returned function in `afterEach` / `afterAll`, or use `clearLocalePacks()`.
 */
export function registerFrenchTestPack(overrides?: Partial<Record<LocaleNamespace, MessageCatalog>>): () => void {
  const prompts: MessageCatalog = {
    ...frenchPromptSections,
    ...(overrides?.prompts ?? {}),
  };
  const catalogs: Record<string, MessageCatalog> = { ...overrides, prompts };
  return registerLocalePack({ locale: FR_TEST_LOCALE, catalogs });
}
