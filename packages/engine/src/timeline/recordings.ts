import type { StoragePort } from "../ports.ts";
import { parseJsonlLines } from "../store/util.ts";
import type { BranchRef } from "../types.ts";
import { recordingsPath } from "./paths.ts";

interface RecordingLine {
  key: string;
  response: unknown;
}

export async function readRecordings(storage: StoragePort, branch: string): Promise<RecordingLine[]> {
  const text = await storage.readText(recordingsPath(branch));
  if (!text) return [];
  return parseJsonlLines(text) as RecordingLine[];
}

export async function lookupRecording(storage: StoragePort, chain: BranchRef[], key: string): Promise<unknown> {
  for (let i = chain.length - 1; i >= 0; i--) {
    const lines = await readRecordings(storage, chain[i]!.name);
    for (let j = lines.length - 1; j >= 0; j--) {
      if (lines[j]!.key === key) return lines[j]!.response;
    }
  }
  return undefined;
}
