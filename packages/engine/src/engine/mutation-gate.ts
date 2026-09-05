import { AnimaeError } from "../types.ts";

/** Single-writer gate for engine mutations (world advance, scene turns, timeline ops). Re-entrant for nested kernel calls. */
export function createMutationGate() {
  let tail: Promise<void> = Promise.resolve();
  let depth = 0;

  async function acquire(): Promise<() => void> {
    if (depth > 0) {
      depth += 1;
      return () => {
        depth -= 1;
      };
    }
    const prev = tail;
    let release!: () => void;
    tail = new Promise((resolve) => {
      release = resolve;
    });
    await prev;
    depth = 1;
    return () => {
      depth -= 1;
      if (depth === 0) release();
    };
  }

  async function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const release = await acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  async function drain(): Promise<void> {
    await tail;
  }

  function busy(): boolean {
    return depth > 0;
  }

  return { withLock, acquire, drain, busy };
}

export function mutationBusyError(): AnimaeError {
  return new AnimaeError("MUTATION_BUSY", "Another engine mutation is in progress");
}

/** Test doubles: no-op exclusive gate. */
export function noopMutationGate(): Pick<ReturnType<typeof createMutationGate>, "withLock" | "acquire"> & {
  runExclusive<T>(fn: () => Promise<T>): Promise<T>;
  acquireExclusive(): Promise<() => void>;
} {
  return {
    withLock: (fn) => fn(),
    acquire: async () => () => {},
    runExclusive: (fn) => fn(),
    acquireExclusive: async () => () => {},
  };
}
