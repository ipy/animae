/** Partial mock objects for tests (avoids `as any`). */
export type PartialDeep<T> = T extends object ? { [P in keyof T]?: PartialDeep<T[P]> } : T;

export function partialMock<T>(value: PartialDeep<T>): T {
  return value as T;
}
