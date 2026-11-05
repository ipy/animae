/** Fail the compile if the bundle graph includes more than one physical React/Ink install. */

export type BundleMetafile = {
  inputs?: Record<string, { bytes?: number; imports?: unknown[] }>;
};

const PKG_PATTERNS: { name: string; re: RegExp }[] = [
  {
    name: "react",
    re: /((?:^|[/])(?:\.\.\/)*(?:animae\/)?node_modules\/\.bun\/react@[^/]+\/node_modules\/react)(?:\/|$)/,
  },
  {
    name: "ink",
    re: /((?:^|[/])(?:\.\.\/)*(?:animae\/)?node_modules\/\.bun\/ink@[^/]+\/node_modules\/ink)(?:\/|$)/,
  },
  {
    name: "react-reconciler",
    re: /((?:^|[/])(?:\.\.\/)*(?:animae\/)?node_modules\/\.bun\/react-reconciler@[^/]+\/node_modules\/react-reconciler)(?:\/|$)/,
  },
];

function physicalRoots(meta: BundleMetafile, re: RegExp): string[] {
  const roots = new Set<string>();
  for (const key of Object.keys(meta.inputs ?? {})) {
    const m = key.match(re);
    if (m?.[1]) roots.add(m[1].replace(/^\.\.\/+/, ""));
  }
  return [...roots].sort();
}

export function assertSingletonInkReactBundle(meta: BundleMetafile, label = "bundle"): void {
  const problems: string[] = [];
  for (const { name, re } of PKG_PATTERNS) {
    const roots = physicalRoots(meta, re);
    if (roots.length > 1) {
      problems.push(`${name}: ${roots.length} copies\n  ${roots.join("\n  ")}`);
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `${label}: multiple React/Ink installs in compile graph (hooks/reconciler will break at runtime).\n` +
        `${problems.join("\n")}\n` +
        "When this repository sits inside another workspace, install from that workspace's root only and remove this repository's own node_modules.",
    );
  }
}
