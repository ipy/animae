import type { Kernel } from "../contracts.ts";
import type { CelContext } from "../types.ts";
import type { ImagePort } from "../ports.ts";
import { modelCelExtra } from "../pipeline/model-cel.ts";

export function imageCelExtra(image?: ImagePort): CelContext {
  return { image: { tags: [...(image?.tags ?? [])] } };
}

export function galleryUnlockCelExtra(unlockedIds: readonly string[], turnKinds: readonly string[]): CelContext {
  return {
    gallery: { unlocked: [...unlockedIds] },
    turn: { kinds: [...turnKinds] },
  };
}

export function mergeCelExtras(...extras: CelContext[]): CelContext {
  const out: Record<string, unknown> = {};
  for (const ex of extras) {
    for (const [k, v] of Object.entries(ex)) {
      if (v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" && !Array.isArray(out[k])) {
        out[k] = { ...(out[k] as Record<string, unknown>), ...(v as Record<string, unknown>) };
      } else {
        out[k] = v;
      }
    }
  }
  return out;
}

export function galleryCelContext(
  k: Kernel,
  image: ImagePort | undefined,
  unlockedIds: readonly string[],
  turnKinds: readonly string[],
  params: Parameters<Kernel["celContext"]>[0],
): ReturnType<Kernel["celContext"]> {
  return k.celContext({
    ...params,
    extra: mergeCelExtras(
      imageCelExtra(image),
      galleryUnlockCelExtra(unlockedIds, turnKinds),
      modelCelExtra(k, "s1"),
      params.extra ?? {},
    ),
  });
}
