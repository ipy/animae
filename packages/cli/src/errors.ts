import { AnimaeError } from "@animae/engine";

export function formatCliError(err: unknown, env: Record<string, string | undefined> = process.env): string {
  if (err instanceof AnimaeError) {
    if (err.code === "MODEL_CONFIG") {
      return `${err.message}\nHint: define models.s1/models.s2 in animae.yaml or set the provider API key environment variables.`;
    }
    if (err.code === "CONFIG_INVALID") {
      const issues = (err.details as { issues?: { file: string; path: string; message: string }[] } | undefined)?.issues;
      if (issues?.length) {
        return issues.map((i) => `${i.file}:${i.path}: ${i.message}`).join("\n");
      }
    }
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

export function printError(err: unknown, stderr: NodeJS.WritableStream = process.stderr): void {
  stderr.write(`${formatCliError(err)}\n`);
}
