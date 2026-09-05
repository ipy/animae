import type { StoragePort } from "../ports.ts";
import { appendJsonl, parseJsonlLines } from "../store/util.ts";
import type { RecordingStore } from "../contracts.ts";
import type { ModelMode } from "../ports.ts";
import type { BranchRef } from "../types.ts";
import { recordingsPath } from "./paths.ts";

interface RecordingLine {
  key: string;
  response: unknown;
}

export function createRecordingStore(
  storage: StoragePort,
  mode: ModelMode,
  getChain: () => BranchRef[],
  getBranch: () => string,
): RecordingStore {
  return {
    mode,
    lookup(key) {
      const chain = getChain();
      for (let i = chain.length - 1; i >= 0; i--) {
        const lines = readSync(storage, chain[i]!.name);
        for (let j = lines.length - 1; j >= 0; j--) {
          if (lines[j]!.key === key) return lines[j]!.response;
        }
      }
      return undefined;
    },
    async record(key, response) {
      if (mode !== "record") return;
      await appendJsonl(storage, recordingsPath(getBranch()), { key, response }, { fsync: true });
    },
  };
}

function readSync(storage: StoragePort, branch: string): RecordingLine[] {
  // RecordingStore.lookup is sync per contract; use cached reads via sync helper in timeline store
  void storage;
  void branch;
  return [];
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
