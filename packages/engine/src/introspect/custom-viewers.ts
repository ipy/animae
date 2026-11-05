import type { Kernel, ViewerDef } from "../contracts.ts";

const customViewers = new WeakMap<Kernel, Map<string, ViewerDef>>();
let evalKernel: Kernel | undefined;

export function customViewerMap(k: Kernel): Map<string, ViewerDef> {
  if (!customViewers.has(k)) customViewers.set(k, new Map());
  return customViewers.get(k)!;
}

export function registerCustomViewer(k: Kernel, v: ViewerDef): void {
  customViewerMap(k).set(v.id, v);
}

/** Active kernel while introspect methods run (so visibility can resolve registered viewers without threading Kernel everywhere). */
export function withIntrospectKernel<T>(k: Kernel, fn: () => T): T {
  const prev = evalKernel;
  evalKernel = k;
  try {
    return fn();
  } finally {
    evalKernel = prev;
  }
}

export function introspectKernelForEval(): Kernel | undefined {
  return evalKernel;
}

/** Viewer ids to match against policy rules: custom id, then `extends` chain (cycle-safe). */
export function viewerInheritanceChain(viewer: string, defs: ReadonlyMap<string, ViewerDef> | undefined): string[] {
  const chain: string[] = [viewer];
  if (!defs?.has(viewer)) return chain;
  const seen = new Set<string>([viewer]);
  let current = viewer;
  for (;;) {
    const def = defs.get(current);
    if (!def?.extends) break;
    const parent = def.extends;
    if (seen.has(parent)) break;
    seen.add(parent);
    chain.push(parent);
    current = parent;
  }
  return chain;
}

export function customViewerDef(viewer: string): ViewerDef | undefined {
  const k = introspectKernelForEval();
  if (!k) return undefined;
  return customViewerMap(k).get(viewer);
}
