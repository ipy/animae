import type { Kernel } from "../contracts.ts";
import type { CelContext } from "../types.ts";

export type ModelCelSlot = "s1" | "s2" | "";

export function modelCelExtra(k: Kernel, tier?: "s1" | "s2"): CelContext {
  const slot: ModelCelSlot = tier === "s2" ? "s2" : tier === "s1" ? "s1" : "s1";
  const port = slot === "s2" ? k.models.s2 : k.models.s1;
  return { model: { slot, tags: [...(port.tags ?? [])] } };
}
