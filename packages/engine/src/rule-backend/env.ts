import type { Kernel } from "../contracts.ts";
import type { ModelCallContext } from "../ports.ts";
import type { CelContext } from "../types.ts";

/** What one rule-backend computation reads: the kernel, the call context, and the CEL variable bag derived from it. */
export interface RuleEnv {
  k: Kernel;
  ctx: Readonly<ModelCallContext>;
  /** CEL variables: the context's fields (`self`, `other`, `event`, `input`, `intent`, ...), `extra` flattened, `model` */
  vars: CelContext;
  /** Locale of player-facing text (`$t:` keys, `{{name:id}}` references). */
  locale: string;
  rng: () => number;
}

/** The marker the rule backend sets on `model` so `when:` expressions can tell which backend wrote the turn. */
export const RULE_MODEL_VAR = { kind: "rule", tags: [] as string[] } as const;

export function createRuleEnv(k: Kernel, ctx: Readonly<ModelCallContext>): RuleEnv {
  const { rng, extra, ...rest } = ctx;
  const vars: CelContext = {
    ...(rest as CelContext),
    ...(extra ?? {}),
    model: { ...RULE_MODEL_VAR, tags: [] },
  };
  return { k, ctx, vars, locale: ctx.call?.outputLocale ?? k.i18n.outputLocale, rng };
}
