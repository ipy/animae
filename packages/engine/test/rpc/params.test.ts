import { describe, expect, test } from "bun:test";
import { INVALID_PARAMS } from "../../src/rpc/jsonrpc.ts";
import { optionalString, paramsObject, requireString, RpcParamError } from "../../src/rpc/params.ts";

function paramError(run: () => unknown): RpcParamError {
  try {
    run();
  } catch (e) {
    expect(e).toBeInstanceOf(RpcParamError);
    return e as RpcParamError;
  }
  throw new Error("the call was expected to fail");
}

describe("paramsObject", () => {
  const names = ["viewer", "path"] as const;

  test("no params at all is an empty object", () => {
    expect(paramsObject(undefined, names)).toEqual({});
  });

  test("a positional list is bound to the method's parameter names; surplus values are dropped", () => {
    expect(paramsObject(["player", "world/time"], names)).toEqual({ viewer: "player", path: "world/time" });
    expect(paramsObject(["player"], names)).toEqual({ viewer: "player" });
    expect(paramsObject(["player", "p", "extra"], names)).toEqual({ viewer: "player", path: "p" });
    expect(paramsObject([], names)).toEqual({});
  });

  test("a named object is passed through as a copy", () => {
    const given = { viewer: "player", other: 1 };
    const out = paramsObject(given, names);
    expect(out).toEqual(given);
    expect(out).not.toBe(given);
  });

  test("anything else is an invalid-params error", () => {
    for (const bad of ["text", 7, true, null]) {
      const err = paramError(() => paramsObject(bad, names));
      expect(err.message).toBe("params must be an array or object");
      expect(err.rpcCode).toBe(INVALID_PARAMS);
    }
  });
});

describe("string parameters", () => {
  test("requireString returns a non-blank string and names the parameter when it is missing or blank", () => {
    expect(requireString("tavern", "location")).toBe("tavern");
    for (const bad of [undefined, null, "", "   ", 3, {}]) {
      const err = paramError(() => requireString(bad, "location"));
      expect(err.message).toBe("location must be a non-empty string");
      expect(err.rpcCode).toBe(INVALID_PARAMS);
    }
  });

  test("optionalString allows a missing value, keeps a string as it is (even an empty one) and rejects other types", () => {
    expect(optionalString(undefined)).toBeUndefined();
    expect(optionalString(null)).toBeUndefined();
    expect(optionalString("")).toBe("");
    expect(optionalString("fr")).toBe("fr");
    for (const bad of [1, true, [], {}]) expect(paramError(() => optionalString(bad)).message).toBe("expected string");
  });
});
