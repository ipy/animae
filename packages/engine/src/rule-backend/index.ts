// The rule backend: deterministic answers to the structured and free-text requests a model would serve.
export { createRuleModelPort, RULE_MODEL_ID } from "../model/rule-port.ts";
export { ruleAppraise, searchTermsOf, type RuleAppraisal } from "./appraise.ts";
export { autonomousLayers, hasAutonomousRules } from "./autonomous.ts";
export { ruleChoices, type RuleChoice } from "./choices.ts";
export { ruleEntity, type EntityCallExtra } from "./entity.ts";
export { createRuleEnv, RULE_MODEL_VAR, type RuleEnv } from "./env.ts";
export { classifyInput, type InputClass } from "./input-class.ts";
export { ruleMemoryWrite, type RuleMemoryWrite } from "./memory-write.ts";
export { ruleOffscreen } from "./offscreen.ts";
export { ruleReflection, type RuleReflection } from "./reflection.ts";
export { isNarrationEntry, isNarrationLayer, ruleRender, type RuleRenderOutput } from "./render.ts";
export { uniformPick, weightedPick, type Weighted } from "./rng.ts";
export { formatTemplateValue, renderTemplate, renderTemplateDeep, templateExpressions, type TemplateOptions } from "./template.ts";
export { locationVar, type LocationVar } from "./location.ts";
