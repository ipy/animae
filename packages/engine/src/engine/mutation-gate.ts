import { AnimaeError } from "../types.ts";

/**
 * Single-writer gate for engine mutations (world advance, scene turns, timeline ops).
 *
 * Semantics:
 * - While the gate is idle, callers are admitted one group at a time in FIFO order.
 * - While the gate is held, further callers *join* the current group instead of waiting. This keeps nested
 *   kernel calls (a hook calling `world.set` from inside a turn) from deadlocking against their own parent.
 * - The gate re-opens when the **last** member of the group releases, regardless of the order in which the
 *   members release. (Joined members are not guaranteed to release LIFO: concurrent flows overlap arbitrarily.)
 */
export function createMutationGate() {
  let tail: Promise<void> = Promise.resolve();
  let holders = 0;
  let open: (() => void) | undefined;

  function leave(): void {
    holders -= 1;
    if (holders > 0) return;
    holders = 0;
    const resolve = open;
    open = undefined;
    resolve?.();
  }

  function releaseOnce(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      leave();
    };
  }

  async function acquire(): Promise<() => void> {
    if (holders > 0) {
      holders += 1;
      return releaseOnce();
    }
    const prev = tail;
    let resolve!: () => void;
    tail = new Promise<void>((r) => {
      resolve = r;
    });
    await prev;
    holders = 1;
    open = resolve;
    return releaseOnce();
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
    return holders > 0;
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
