import { getGalleryPromptSection } from "../prompts/gallery-sections.ts";

export interface BuildBriefPromptInput {
  promptLocale: string;
  outputLocale: string;
  promptLanguage: string;
  sceneFacts: string;
  characterBlock: string;
  ratingBrief: string;
  gameGuidance: string;
  maxCharacters: number;
  focus?: string;
}

export function buildCgBriefPrompt(input: BuildBriefPromptInput): string {
  const vars = {
    sceneFacts: input.sceneFacts,
    characterBlock: input.characterBlock,
    ratingBrief: input.ratingBrief,
    gameGuidance: input.gameGuidance,
    maxCharacters: String(input.maxCharacters),
    outputLocale: input.outputLocale,
    promptLanguage: input.promptLanguage,
    focus: input.focus ?? "",
  };
  const parts = [
    "role",
    "scene",
    "characters",
    "composition",
    "rating",
    "guidance",
    "contract",
  ] as const;
  return parts.map((k) => getGalleryPromptSection(input.promptLocale, k, vars)).filter(Boolean).join("\n\n");
}
