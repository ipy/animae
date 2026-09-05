import type { PresetBundle } from "@animae/engine";
import { generatedBundle } from "./generated.ts";
import { notice } from "./notice.ts";
import { registerDndRules } from "./rules.ts";

export const preset: PresetBundle = {
  ...generatedBundle,
  notice,
  rules: registerDndRules,
};
export default preset;

export { notice } from "./notice.ts";
export { abilityModifier, proficiencyBonus, skillModifier, SKILL_ABILITIES, DEFAULT_ABILITIES } from "./math.ts";
export { conditionField, type ConditionName, type ConditionParams } from "./conditions.ts";
export { rest, REST_DURATIONS, type RestEngine } from "./rest.ts";
export { dndIntimidationExtra, registerDndRules } from "./rules.ts";
