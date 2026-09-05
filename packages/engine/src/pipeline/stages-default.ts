import type { AppraiseStageFn, RenderStageFn, BuildPromptSegments } from "./types.ts";
import { appraiseStage } from "./appraise.ts";
import { renderStage } from "./render.ts";
import { buildPromptSegments } from "./prompt.ts";

export function resolveAppraiseStage(): AppraiseStageFn {
  return appraiseStage;
}

export function resolveRenderStage(): RenderStageFn {
  return renderStage;
}

export function resolveBuildPromptSegments(): BuildPromptSegments {
  return buildPromptSegments;
}
