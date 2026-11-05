/** Typed fetch stub for model/reasoning-fetch tests (single boundary cast). */
export function stubFetch(
  impl: (input: Request | URL | string, init?: RequestInit) => Promise<Response>,
): typeof fetch {
  return impl as typeof fetch;
}
