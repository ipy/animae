import type { CelEngine, RuleEngine, RuleFn, RuleCtx } from "../contracts.ts";
import type { EventDraft } from "../types.ts";
import { AnimaeError } from "../types.ts";
import { createRng } from "../timeline/rng.ts";

function validateDrafts(drafts: unknown): EventDraft[] {
  if (!Array.isArray(drafts)) {
    throw new AnimaeError("RULE_INVALID", "rule function must return an array of event drafts");
  }
  for (const d of drafts) {
    if (!d || typeof d !== "object" || typeof (d as EventDraft).kind !== "string") {
      throw new AnimaeError("RULE_INVALID", "each draft must be { kind: string, ... }");
    }
  }
  return drafts as EventDraft[];
}

export function createRuleEngine(
  cel: CelEngine,
  rngScope?: () => { seed: number; rootBranch: string },
): RuleEngine {
  const fns = new Map<string, RuleFn>();

  return {
    cel,
    register(name: string, fn: RuleFn) {
      fns.set(name, fn);
    },
    fn(name: string) {
      return fns.get(name);
    },
    has(name: string) {
      return fns.has(name);
    },
    run(name: string, ctx: Omit<RuleCtx, "rng"> & { rngKey: string }): EventDraft[] {
      const fn = fns.get(name);
      if (!fn) throw new AnimaeError("RULE_MISSING", `rule function "${name}" is not registered`);
      const scope = rngScope?.() ?? { seed: 0, rootBranch: "" };
      const rng = createRng(scope.seed, scope.rootBranch, ctx.rngKey);
      const withRng: RuleCtx = {
        stage: ctx.stage,
        state: ctx.state,
        authored: ctx.authored,
        policy: ctx.policy,
        time: ctx.time,
        vars: ctx.vars,
        rng: () => rng.next(),
      };
      Object.freeze(withRng);
      const out = fn(withRng);
      if (!Array.isArray(out)) throw new AnimaeError("RULE_INVALID", `rule "${name}" must return EventDraft[]`);
      return validateDrafts(out);
    },
  };
}
