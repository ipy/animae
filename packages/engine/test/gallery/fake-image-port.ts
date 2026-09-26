import type { ImageGenerateOptions, ImagePort, ImageRequest, ImageResult } from "../../src/ports.ts";

export type FakeImageBehavior =
  | { kind: "instant"; mime?: ImageResult["mime"] }
  | { kind: "delay"; ms: number }
  | { kind: "fail"; message?: string }
  | { kind: "abortable" }
  | { kind: "garbage" }
  | { kind: "empty" };

const MIN_PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00,
  0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78,
  0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
  0xae, 0x42, 0x60, 0x82,
]);

export function createFakeImagePort(id: string, behavior: FakeImageBehavior, tags?: string[]): ImagePort & { calls: ImageRequest[] } {
  const calls: ImageRequest[] = [];
  return {
    id,
    tags,
    calls,
    async generate(req: ImageRequest, opts?: ImageGenerateOptions): Promise<ImageResult> {
      calls.push(req);
      if (behavior.kind === "fail") {
        throw new Error(behavior.message ?? "fake failure");
      }
      if (behavior.kind === "empty") {
        return { bytes: new Uint8Array(0), mime: "image/png", width: 1, height: 1 };
      }
      if (behavior.kind === "garbage") {
        return { bytes: Uint8Array.from([1, 2, 3, 4]), mime: "image/png", width: 1, height: 1 };
      }
      if (behavior.kind === "delay") {
        await new Promise((r, rej) => {
          if (opts?.signal?.aborted) {
            rej(opts.signal.reason ?? new DOMException("Aborted", "AbortError"));
            return;
          }
          const t = setTimeout(r, behavior.ms);
          opts?.signal?.addEventListener("abort", () => {
            clearTimeout(t);
            rej(opts.signal?.reason ?? new DOMException("Aborted", "AbortError"));
          });
        });
      }
      if (behavior.kind === "abortable") {
        await new Promise((r, rej) => {
          opts?.signal?.addEventListener("abort", () => rej(opts.signal?.reason ?? new DOMException("Aborted", "AbortError")));
          const t = setTimeout(r, 60_000);
          opts?.signal?.addEventListener("abort", () => clearTimeout(t));
        });
      }
      opts?.onProgress?.(1);
      return {
        bytes: MIN_PNG,
        mime: behavior.kind === "instant" ? (behavior.mime ?? "image/png") : "image/png",
        width: 1,
        height: 1,
        seed: req.seed,
      };
    },
  };
}
