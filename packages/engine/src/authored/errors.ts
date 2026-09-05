import { AnimaeError } from "../types.ts";

export type ConfigIssue = { file: string; path: string; message: string };

export function formatConfigIssues(issues: ConfigIssue[]): string {
  return issues.map((i) => `${i.file}:${i.path}: ${i.message}`).join("\n");
}

export function throwConfigInvalid(issues: ConfigIssue[]): never {
  throw new AnimaeError("CONFIG_INVALID", formatConfigIssues(issues), { issues });
}

export function zodIssues(file: string, err: { issues: { path: PropertyKey[]; message: string }[] }): ConfigIssue[] {
  return err.issues.map((issue) => ({
    file,
    path: issue.path.length ? issue.path.map(String).join(".") : "(root)",
    message: issue.message,
  }));
}
