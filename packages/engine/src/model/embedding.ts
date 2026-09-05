import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOllama } from "ollama-ai-provider-v2";
import { embedMany } from "ai";
import { AnimaeError } from "../types.ts";
import type { EmbeddingPort } from "../ports.ts";
import type { ModelSpec } from "../schema/authored.ts";
import { normalizeOllamaBaseURL, resolveApiKey, resolveAnthropicBaseURL } from "./provider.ts";
import type { ModelPortOptions } from "./types.ts";
import { fileModelWarningSink, installAiSdkWarningHandler, registerModelWarningSink } from "./warnings.ts";

/**
 * Optional embedding adapter (off by default at engine wiring).
 * Uses the same ModelSpec shape; `model` is the embedding model id.
 */
export function createEmbeddingPort(spec: ModelSpec, opts: ModelPortOptions = {}): EmbeddingPort {
  installAiSdkWarningHandler();
  if (opts.warningLogPath) fileModelWarningSink(opts.warningLogPath);
  if (opts.warningSink) registerModelWarningSink(opts.warningSink);
  const env = opts.env ?? (typeof process !== "undefined" ? process.env : {});
  const apiKey = resolveApiKey(spec, env, { warningSink: opts.warningSink });
  const fetchFn = opts.fetch;

  const embeddingModel = (() => {
    switch (spec.provider) {
      case "anthropic":
        return createAnthropic({
          apiKey,
          baseURL: resolveAnthropicBaseURL(spec, env),
          headers: spec.headers,
          fetch: fetchFn,
        }).embeddingModel(spec.model);
      case "openai":
        return createOpenAI({ apiKey, baseURL: spec.baseURL, headers: spec.headers, fetch: fetchFn }).embeddingModel(
          spec.model,
        );
      case "google":
        return createGoogleGenerativeAI({
          apiKey,
          baseURL: spec.baseURL,
          headers: spec.headers,
          fetch: fetchFn,
        }).embeddingModel(spec.model);
      case "deepseek":
        throw new AnimaeError("MODEL_CONFIG", "deepseek provider does not expose embeddings; use openai or ollama");
      case "ollama": {
        const p = createOllama({
          baseURL: normalizeOllamaBaseURL(spec.baseURL),
          headers: spec.headers,
          fetch: fetchFn,
          compatibility: "strict",
        });
        return p.textEmbeddingModel(spec.model);
      }
      case "openai-compatible": {
        if (!spec.baseURL?.trim()) {
          throw new AnimaeError("MODEL_CONFIG", "openai-compatible provider requires baseURL");
        }
        return createOpenAICompatible({
          name: spec.name?.trim() || "openai-compatible",
          baseURL: spec.baseURL,
          apiKey: apiKey ?? "",
          headers: spec.headers,
          fetch: fetchFn,
        }).embeddingModel(spec.model);
      }
      default: {
        const _e: never = spec.provider;
        throw new AnimaeError("MODEL_CONFIG", `Unknown provider: ${String(_e)}`);
      }
    }
  })();

  return {
    async embed(texts: string[]) {
      const { embeddings } = await embedMany({ model: embeddingModel, values: texts, maxRetries: 0 });
      return embeddings.map((e) => Float32Array.from(e));
    },
  };
}
