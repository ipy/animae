import { Environment, EvaluationError, ParseError, TypeError } from "@marcbachmann/cel-js";
import { setCelValidator } from "../schema/common.ts";
import type { CelEngine } from "../contracts.ts";
import type { CelContext } from "../types.ts";
import { AnimaeError } from "../types.ts";

const sharedEnv = new Environment({ unlistedVariablesAreDyn: true });

sharedEnv.registerFunction("abilityMod(int): int", (score) => {
  const s = Number(score);
  return BigInt(Math.floor((s - 10) / 2));
});

sharedEnv.registerFunction("profBonus(int): int", (level) => {
  const l = Number(level);
  return BigInt(2 + Math.floor((l - 1) / 4));
});

sharedEnv.registerFunction("maxInt(int, int): int", (a, b) => (a > b ? a : b));

/** Convert cel-js runtime values to JSON-friendly doubles where appropriate. */
export function adaptCelResult(value: unknown): unknown {
  if (typeof value === "bigint") {
    const n = Number(value);
    if (!Number.isSafeInteger(n) && value !== BigInt(n)) {
      throw new AnimaeError("CEL_EVAL", `CEL integer ${value.toString()} exceeds safe JS number range`);
    }
    return n;
  }
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return value.map(adaptCelResult);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = adaptCelResult(v);
    return out;
  }
  return value;
}

function celNumber(v: number): number | bigint {
  if (Number.isInteger(v) && Number.isSafeInteger(v)) return BigInt(v);
  return v;
}

/** Prepare context for cel-js 8.x: safe integers as bigint, fractional values as double; strip undefined. */
export function adaptCelContext(ctx: CelContext): Record<string, unknown> {
  const walk = (v: unknown): unknown => {
    if (v === undefined) return null;
    if (typeof v === "bigint") return v;
    if (typeof v === "number") return celNumber(v);
    if (typeof v === "string" || typeof v === "boolean" || v === null) return v;
    if (Array.isArray(v)) return v.map((x) => walk(x));
    if (typeof v === "object") {
      const o: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) o[k] = walk(val);
      return o;
    }
    return v;
  };
  return walk(ctx) as Record<string, unknown>;
}

const CEL_MISSING_KEY_HINT =
  " — hint: guard optional keys with `'key' in world.vars` or declare an initial value under `vars:` in world.yaml";

function celNoSuchKey(err: unknown): boolean {
  if (!(err instanceof EvaluationError)) return false;
  const summary = err.summary || err.message;
  return summary.startsWith("No such key:");
}

function celErrorMessage(expr: string, err: unknown): string {
  let base: string;
  if (err instanceof ParseError || err instanceof TypeError || err instanceof EvaluationError) {
    base = `${err.summary || err.message} (expression: ${expr})`;
  } else if (err instanceof Error) {
    base = `${err.message} (expression: ${expr})`;
  } else {
    base = `CEL error (expression: ${expr})`;
  }
  if (celNoSuchKey(err)) return base + CEL_MISSING_KEY_HINT;
  return base;
}

/** Compile-only check for zod `Cel` fields. */
export function celCheck(expr: string): string | undefined {
  try {
    const r = sharedEnv.check(expr);
    if (!r.valid) return r.error?.summary || r.error?.message || "type check failed";
    return undefined;
  } catch (e) {
    return celErrorMessage(expr, e);
  }
}

setCelValidator(celCheck);

export function createCelEngine(): CelEngine {
  const cache = new Map<string, ReturnType<Environment["parse"]>>();

  function compile(expr: string) {
    let fn = cache.get(expr);
    if (!fn) {
      fn = sharedEnv.parse(expr);
      cache.set(expr, fn);
    }
    return fn;
  }

  function evalExpr<T>(expr: string, ctx: CelContext): T {
    try {
      const fn = compile(expr);
      const raw = fn(adaptCelContext(ctx));
      return adaptCelResult(raw) as T;
    } catch (e) {
      throw new AnimaeError("CEL_EVAL", celErrorMessage(expr, e));
    }
  }

  return {
    check(expr: string) {
      return celCheck(expr);
    },
    eval: evalExpr,
    bool(expr, ctx) {
      if (typeof expr === "boolean") return expr;
      return Boolean(evalExpr(expr, ctx));
    },
    num(expr, ctx) {
      if (typeof expr === "number") return expr;
      const v = evalExpr<number>(expr, ctx);
      if (typeof v !== "number" || Number.isNaN(v)) {
        throw new AnimaeError("CEL_EVAL", `expected number from (${expr}), got ${typeof v}`);
      }
      return v;
    },
    str(expr, ctx) {
      const v = evalExpr(expr, ctx);
      if (typeof v !== "string") throw new AnimaeError("CEL_EVAL", `expected string from (${expr})`);
      return v;
    },
  };
}
