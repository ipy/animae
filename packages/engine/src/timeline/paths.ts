export const TIMELINES_DIR = "timelines";
export const HEAD_FILE = `${TIMELINES_DIR}/HEAD`;
export const SAVES_FILE = "saves.yaml";
export const EXPORTS_DIR = "exports";
export const LOCK_FILE = ".animae.lock";

export function branchDir(branch: string): string {
  return `${TIMELINES_DIR}/${branch}`;
}

export function eventsPath(branch: string): string {
  return `${branchDir(branch)}/events.jsonl`;
}

export function snapshotsDir(branch: string): string {
  return `${branchDir(branch)}/snapshots`;
}

export function snapshotPath(branch: string, eventId: string): string {
  return `${snapshotsDir(branch)}/${eventId}.json`;
}

export function artifactsDir(branch: string): string {
  return `${branchDir(branch)}/artifacts`;
}

export function artifactPath(branch: string, rel: string): string {
  return `${artifactsDir(branch)}/${rel}`;
}

export function artifactIndexPath(branch: string): string {
  return `${artifactPath(branch, ".index.jsonl")}`;
}

export function recordingsPath(branch: string): string {
  return `${branchDir(branch)}/recordings.jsonl`;
}

export function entitiesPath(branch: string, kind: string, id: string): string {
  return `${branchDir(branch)}/entities/${kind}/${id}.json`;
}
