import { createFakeKernel, charDef, type FakeKernelOpts } from "../support/kernel-fake.ts";
import { createMemoryService } from "../../src/memory/service.ts";
import { createRouter } from "../../src/router/router.ts";
import { buildCelContext } from "../../src/rules/cel-context.ts";
import { createScriptedModel } from "../../src/model/scripted.ts";
import type { Kernel } from "../../src/contracts.ts";
import type { EngineState } from "../../src/state.ts";

export function createPipelineKernel(opts: FakeKernelOpts & { s1Handler?: Parameters<typeof createScriptedModel>[1] } = {}): {
  k: Kernel;
  setState: (s: EngineState) => void;
} {
  const { k, setState } = createFakeKernel(opts);
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
  if (opts.s1Handler) {
    k.models.s1 = createScriptedModel("scripted/s1", opts.s1Handler);
  }
  if (opts.s2Handler) {
    k.models.s2 = createScriptedModel("scripted/s2", opts.s2Handler);
  }
  return { k, setState };
}

export { charDef };
