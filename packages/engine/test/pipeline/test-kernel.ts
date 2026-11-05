import { createFakeKernel, charDef, type FakeKernelOpts } from "../support/kernel-fake.ts";
import { createMemoryService } from "../../src/memory/service.ts";
import { createRouter } from "../../src/router/router.ts";
import { buildCelContext } from "../../src/rules/cel-context.ts";
import { createScriptedModel, type ScriptedHandler } from "../../src/model/scripted.ts";
import type { Kernel } from "../../src/contracts.ts";
import type { EngineState } from "../../src/state.ts";

export function createPipelineKernel(
  opts: Omit<FakeKernelOpts, "s1Handler" | "s2Handler"> & { s1Handler?: ScriptedHandler; s2Handler?: ScriptedHandler } = {},
): {
  k: Kernel;
  setState: (s: EngineState) => void;
} {
  const { s1Handler, s2Handler, ...kernelOpts } = opts;
  const { k, setState } = createFakeKernel(kernelOpts);
  const memory = createMemoryService(k);
  k.m.memory = memory;
  k.m.router = createRouter(k);
  if (!k.m.director.beatNote) {
    k.m.director.beatNote = () => undefined;
  }
  k.celContext = (p) =>
    buildCelContext(
      { state: k.timeline.state(), authored: k.authored, policy: k.policy, catalog: k.catalog },
      {
        self: p.self,
        other: p.other,
        actor: p.actor,
        event: p.event,
        sceneId: p.sceneId,
        check: p.check as Record<string, unknown> | null,
        extra: p.extra,
      },
    );
  if (s1Handler) {
    k.models.s1 = createScriptedModel("scripted/s1", s1Handler);
  }
  if (s2Handler) {
    k.models.s2 = createScriptedModel("scripted/s2", s2Handler);
  }
  return { k, setState };
}

export { charDef };

/** Binding of an LLM render served by the scripted S2 model (`k.models.s2`) as the only tier. */
export const S2_BINDING = { backend: "llm", slot: "s2", tier: "only", model: "scripted/s2" } as const;
