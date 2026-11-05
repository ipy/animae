import { spawn } from "node:child_process";
import type { ImageGenerateOptions, ImagePort, ImageRequest, ImageResult } from "@animae/engine";
import { AnimaeError } from "@animae/engine";

export interface CommandImagePortOptions {
  /** Executable path or name on PATH. */
  command: string;
  /** Extra argv before stdin is attached (prompt JSON written to stdin). */
  args?: string[];
  /** Stable port id recorded on image records. */
  id?: string;
  /** Optional capability tags (CEL `image.tags`). */
  tags?: readonly string[];
  /** Max runtime before abort (default 600_000 ms). */
  timeoutMs?: number;
}

/**
 * External-process ImagePort: writes `ImageRequest` JSON to stdin; expects raw image bytes on stdout.
 * Non-zero exit → `GALLERY_GENERATION_FAILED`.
 */
export function createCommandImagePort(opts: CommandImagePortOptions): ImagePort {
  const args = opts.args ?? [];
  const timeoutMs = opts.timeoutMs ?? 600_000;
  const portId = opts.id ?? `command-image/${opts.command}`;

  return {
    id: portId,
    tags: opts.tags,
    generate(req: ImageRequest, gen?: ImageGenerateOptions): Promise<ImageResult> {
      return new Promise((resolve, reject) => {
        const child = spawn(opts.command, args, {
          stdio: ["pipe", "pipe", "pipe"],
          env: process.env,
        });
        const chunks: Buffer[] = [];
        let stderr = "";
        child.stdout?.on("data", (c) => chunks.push(Buffer.from(c)));
        child.stderr?.on("data", (c) => {
          stderr = (stderr + String(c)).slice(-4096);
        });

        const onAbort = () => {
          try {
            child.kill("SIGTERM");
          } catch {
            /* ignore */
          }
        };
        gen?.signal?.addEventListener("abort", onAbort, { once: true });

        const timer = setTimeout(() => {
          onAbort();
          reject(new AnimaeError("GALLERY_GENERATION_FAILED", `image command timed out: ${stderr}`));
        }, timeoutMs);

        child.on("error", (err) => {
          clearTimeout(timer);
          gen?.signal?.removeEventListener("abort", onAbort);
          reject(new AnimaeError("GALLERY_GENERATION_FAILED", err.message));
        });

        child.on("close", (code) => {
          clearTimeout(timer);
          gen?.signal?.removeEventListener("abort", onAbort);
          if (code !== 0) {
            reject(
              new AnimaeError("GALLERY_GENERATION_FAILED", `image command exited ${code ?? "?"}: ${stderr}`),
            );
            return;
          }
          const buf = Buffer.concat(chunks);
          if (buf.length < 16) {
            reject(new AnimaeError("GALLERY_GENERATION_FAILED", "empty image output"));
            return;
          }
          const mime = sniffMime(buf);
          if (!mime) {
            reject(new AnimaeError("GALLERY_GENERATION_FAILED", "unrecognized image bytes"));
            return;
          }
          resolve({
            bytes: new Uint8Array(buf),
            mime,
            width: 0,
            height: 0,
            seed: req.seed,
            meta: { command: opts.command },
          });
        });

        child.stdin?.on("error", () => {
          /* child exited before reading stdin (e.g. aborted) — ignore */
        });
        child.stdin?.write(JSON.stringify(req));
        child.stdin?.end();
      });
    },
  };
}

function sniffMime(buf: Buffer): ImageResult["mime"] | undefined {
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  return undefined;
}
