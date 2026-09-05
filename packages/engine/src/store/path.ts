import { AnimaeError } from "../types.ts";

/** Reject absolute paths and `..` segments (POSIX-style relative paths only). */
export function assertRelativePath(path: string): string {
  if (!path || path.startsWith("/") || path.includes("\\")) {
    throw new AnimaeError("STORAGE_PATH", `Invalid storage path: ${path}`);
  }
  const parts = path.split("/");
  for (const p of parts) {
    if (p === "..") throw new AnimaeError("STORAGE_PATH", `Invalid storage path: ${path}`);
  }
  return path.replace(/\/+/g, "/").replace(/^\.\//, "");
}

export function joinPath(...segments: string[]): string {
  return assertRelativePath(segments.filter(Boolean).join("/"));
}
