import type { ZodType } from "zod";
import type { Kernel } from "../contracts.ts";
import type { ModelPort, ModelRequestBase, StreamPart } from "../ports.ts";
import { AnimaeError, type Usage } from "../types.ts";
import { ruleAppraise } from "../rule-backend/appraise.ts";
import { autonomousLayers } from "../rule-backend/autonomous.ts";
import { ruleChoices } from "../rule-backend/choices.ts";
import { createRuleEnv } from "../rule-backend/env.ts";
import { ruleEntity } from "../rule-backend/entity.ts";
import { classifyInput } from "../rule-backend/input-class.ts";
import { ruleMemoryWrite } from "../rule-backend/memory-write.ts";
import { ruleOffscreen } from "../rule-backend/offscreen.ts";
import { ruleReflection } from "../rule-backend/reflection.ts";
import { ruleRender } from "../rule-backend/render.ts";

/** Id of the rule port; it shows up as the model id in `route.decided`-adjacent logs and in `Engine.info()`. */
export const RULE_MODEL_ID = "rule";

const NO_USAGE: Usage = { inputTokens: 0, outputTokens: 0 };

type ObjectRequest<T> = ModelRequestBase & { schema: ZodType<T> };

function needContext(req: ModelRequestBase): NonNullable<ModelRequestBase["context"]> {
  if (!req.purpose || !req.context) {
    throw new AnimaeError(
      "RULE_UNSUPPORTED",
      `the rule backend needs a request with \`purpose\` and \`context\` (call "${req.label}")`,
    );
  }
  return req.context;
}

/**
 * The rule backend as a `ModelPort`. It answers the same requests an LLM port does, from the structured `context` of
 * the request instead of the prompt, and the answer goes through the request's own schema, so a rule answer and a
 * model answer are interchangeable downstream. Everything it does is deterministic: all draws come from
 * `context.rng`, and it reads no clock and no network.
 */
export function createRuleModelPort(k: Kernel): ModelPort {
  return {
    id: RULE_MODEL_ID,
    tags: [],
    usage: () => ({ ...NO_USAGE }),

    async object<T>(req: ObjectRequest<T>): Promise<T> {
      const context = needContext(req);
      const env = createRuleEnv(k, context);
      let raw: unknown;
      switch (req.purpose) {
        case "appraise":
          raw = ruleAppraise(env);
          break;
        case "classify":
          raw = { input_class: classifyInput(k, context.input?.text ?? "") };
          break;
        case "safety":
          raw = { safety: "none" };
          break;
        case "reflection":
          raw = ruleReflection(env);
          break;
        case "entity":
          raw = ruleEntity(env);
          break;
        case "memory-write":
          raw = ruleMemoryWrite(env);
          break;
        default:
          throw new AnimaeError("RULE_UNSUPPORTED", `the rule backend does not answer structured calls for purpose "${String(req.purpose)}"`);
      }
      return req.schema.parse(raw) as T;
    },

    stream(req: ModelRequestBase & { schema: ZodType<unknown> }): AsyncIterable<StreamPart> {
      return ruleStream(k, req);
    },
  };
}

async function* ruleStream(k: Kernel, req: ModelRequestBase & { schema: ZodType<unknown> }): AsyncGenerator<StreamPart> {
  const context = needContext(req);
  const env = createRuleEnv(k, context);
  let raw: unknown;
  switch (req.purpose) {
    case "render":
    case "autonomous": {
      const layers = req.purpose === "autonomous" ? autonomousLayers(k) : (k.policy.render.layers ?? []);
      const out = ruleRender(env, layers);
      const choices = ruleChoices(env);
      raw = choices ? { ...out, choices } : out;
      break;
    }
    case "offscreen":
      raw = ruleOffscreen(env);
      break;
    default:
      throw new AnimaeError("RULE_UNSUPPORTED", `the rule backend does not answer streamed calls for purpose "${String(req.purpose)}"`);
  }
  yield { type: "final", value: req.schema.parse(raw), usage: { ...NO_USAGE } };
}
