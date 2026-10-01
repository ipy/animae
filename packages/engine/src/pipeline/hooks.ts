import type { Kernel, Stage, StageHook, TurnCtx } from "../contracts.ts";

export type StageRunner = (k: Kernel, t: TurnCtx) => Promise<unknown>;

export class HookRegistry {
  private hooks = new Map<Stage, StageHook[]>();

  register(stage: Stage, fn: StageHook): void {
    const list = this.hooks.get(stage) ?? [];
    list.push(fn);
    this.hooks.set(stage, list);
  }

  /** Wrap `runDefault` with registered hooks (outermost hook runs first). */
  async run(stage: Stage, k: Kernel, t: TurnCtx, runDefault: StageRunner): Promise<unknown> {
    const stack = this.hooks.get(stage) ?? [];
    let idx = -1;
    const dispatch = async (): Promise<unknown> => {
      idx += 1;
      if (idx >= stack.length) return runDefault(k, t);
      return stack[idx]!(t, dispatch, k);
    };
    return dispatch();
  }
}
