/** Extra `bun build` flags for compiled Ink/TUI binaries (game-neutral). */
export function inkCompileBundlerFlags(metafilePath: string): string[] {
  return [`--metafile=${metafilePath}`, "--define", "process.env.DEV='false'"];
}
