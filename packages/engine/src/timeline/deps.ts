import type { CelEngine } from "../contracts.ts";
import type { Authored } from "../schema/authored.ts";
import type { ResolvedPolicy } from "../schema/policy.ts";
import type { StoragePort, ModelMode } from "../ports.ts";

export interface TimelineDeps {
  storage: StoragePort;
  authored: () => Authored;
  policy: () => ResolvedPolicy;
  cel: CelEngine;
  seed: number;
  sessionId: string;
  now?: () => Date;
  modelMode: ModelMode;
  presetId?: string;
}
