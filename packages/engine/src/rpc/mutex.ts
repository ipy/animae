/** Serialise async work (one in flight at a time). */
export function createMutex(): { run<T>(fn: () => Promise<T>): Promise<T> } {
  let tail: Promise<void> = Promise.resolve();
  return {
    run<T>(fn: () => Promise<T>): Promise<T> {
      const next = tail.then(fn, fn);
      tail = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
  };
}
