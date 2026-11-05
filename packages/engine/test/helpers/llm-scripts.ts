import { createScriptedModel, type ScriptedHandler } from "../../src/model/scripted.ts";
import type { ModelPort } from "../../src/ports.ts";

export type ScriptedRequest = Parameters<ScriptedHandler>[0];

export interface ScriptedLlmOptions {
  /**
   * Called for every request before the default answer; return a value to replace it, `undefined` to keep the default,
   * or throw to fail the call. May be async (a test can hold a call open).
   */
  s1?: (req: ScriptedRequest, n: number) => unknown;
  s2?: (req: ScriptedRequest, n: number) => unknown;
  /** Narration paragraphs the S2 render answer carries. */
  narrations?: { text: string; style: "normal" | "scene_break" }[];
  /** Model ids (the id is part of every recording key). */
  ids?: { s1?: string; s2?: string };
}

export interface ScriptedLlm {
  s1: ModelPort;
  s2: ModelPort;
  /** Labels of the requests each port received, in order. */
  calls: { s1: string[]; s2: string[] };
  /** The `purpose` each request carried, in order (the engine always sets it). */
  purposes: { s1: (string | undefined)[]; s2: (string | undefined)[] };
}

/** The schema-conformant answer a well-behaved model gives to each kind of request. */
export function defaultAnswer(req: ScriptedRequest, n: number, narrations?: ScriptedLlmOptions["narrations"]): unknown {
  switch (req.label) {
    case "appraise":
      return {
        type: "chat",
        intensity: 0.55,
        sincerity: 0.9,
        claims: [],
        search_terms: ["tavern"],
        tags: [],
        input_class: "normal",
      };
    case "reflect":
      return { summaries: [], goal_changes: [], new_claims: [] };
    default:
      return {
        text: `Hello from the model ${n}.`,
        cues: [],
        intent_realized: "talk",
        ...(narrations ? { narrations } : {}),
      };
  }
}

/** A pair of scripted LLM ports that answer every request kind with schema-valid data and record what they were asked. */
export function scriptedLlm(opts: ScriptedLlmOptions = {}): ScriptedLlm {
  const calls = { s1: [] as string[], s2: [] as string[] };
  const purposes = { s1: [] as (string | undefined)[], s2: [] as (string | undefined)[] };
  const make = (role: "s1" | "s2", id: string, custom: ScriptedLlmOptions["s1"]) =>
    createScriptedModel(id, async (req) => {
      calls[role].push(req.label);
      purposes[role].push(req.purpose);
      const n = calls[role].length;
      const answer = await custom?.(req, n);
      return answer !== undefined ? answer : defaultAnswer(req, n, opts.narrations);
    });
  return {
    s1: make("s1", opts.ids?.s1 ?? "llm/s1", opts.s1),
    s2: make("s2", opts.ids?.s2 ?? "llm/s2", opts.s2),
    calls,
    purposes,
  };
}
