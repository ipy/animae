import type { Kernel } from "../contracts.ts";
import { tiersOf } from "../model/select.ts";
import type { AppraiseBinding, RenderBinding } from "../runtime/types.ts";
import type { CelContext } from "../types.ts";

/** What `model` means to a CEL expression: which role (and tier) is answering, and that port's capability tags. */
export type ModelCelSelector =
  | { kind: "s1" }
  | { kind: "s2"; tier?: string }
  | { kind: "rule" }
  | { kind: "" };

/**
 * The `model` CEL variable: `{ kind: "s1" | "s2" | "rule" | "", tier?, tags[] }`. Under the rule backend `tags` is empty:
 * an expression such as `"premium" in model.tags` is false there, which is the documented degradation of tag-gated content.
 */
export function modelCelExtra(k: Kernel, sel: ModelCelSelector): CelContext {
  switch (sel.kind) {
    case "s1":
      return { model: { kind: "s1", tags: [...(k.models.s1.tags ?? [])] } };
    case "s2": {
      const port = (sel.tier !== undefined ? tiersOf(k).get(sel.tier)?.port : undefined) ?? k.models.s2;
      return { model: { kind: "s2", ...(sel.tier !== undefined ? { tier: sel.tier } : {}), tags: [...(port.tags ?? [])] } };
    }
    case "rule":
      return { model: { kind: "rule", tags: [] } };
    default:
      return { model: { kind: "", tags: [] } };
  }
}

export function selectorOfAppraise(binding: AppraiseBinding): ModelCelSelector {
  return binding.backend === "llm" ? { kind: "s1" } : { kind: "rule" };
}

export function selectorOfRender(binding: RenderBinding): ModelCelSelector {
  return binding.backend === "llm" ? { kind: "s2", tier: binding.tier } : { kind: "rule" };
}
