/** Canonical CommandApi surface shared by TUI and web SessionHost. */
export const COMMAND_API_METHODS = [
  "engine",
  "viewer",
  "actor",
  "sceneId",
  "startScene",
  "endScene",
  "notify",
  "openOverlay",
  "closeOverlay",
  "setMouseCapture",
  "locale",
  "t",
] as const;

export type CommandApiMethodName = (typeof COMMAND_API_METHODS)[number];

const fnMethods = new Set<CommandApiMethodName>([
  "sceneId",
  "startScene",
  "endScene",
  "notify",
  "openOverlay",
  "closeOverlay",
  "setMouseCapture",
  "locale",
  "t",
]);

export function guardCommandApi<T extends object>(api: T, label = "HostCommandApi"): T {
  const guard =
    process.env.ANIMAE_COMMAND_API_GUARD === "1" ||
    process.env.NODE_ENV === "test" ||
    process.env.NODE_ENV === "development";
  if (!guard) return api;

  return new Proxy(api, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && fnMethods.has(prop as CommandApiMethodName)) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== "function") {
          throw new Error(`${label}.${prop} is not implemented (expected function)`);
        }
        return value;
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}
