import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOllama } from "ollama-ai-provider-v2";
import type { LanguageModel } from "ai";
import { AnimaeError } from "../types.ts";
import type { ModelSpec } from "../schema/authored.ts";
import type { ModelWarningSink } from "./warnings.ts";
import { warnMissingApiKey } from "./warnings.ts";

const DEFAULT_KEY_ENV: Record<ModelSpec["provider"], string | undefined> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  "openai-compatible": "OPENAI_COMPATIBLE_API_KEY",
  ollama: undefined,
};

export function defaultApiKeyEnv(provider: ModelSpec["provider"]): string | undefined {
  return DEFAULT_KEY_ENV[provider];
}

export function resolveApiKey(
  spec: ModelSpec,
  env: Record<string, string | undefined>,
  opts?: { warningSink?: ModelWarningSink },
): string | undefined {
  if (spec.apiKey?.trim()) return spec.apiKey.trim();
  const envName = spec.apiKeyEnv ?? DEFAULT_KEY_ENV[spec.provider];
  if (!envName) return undefined;
  const fromEnv = env[envName];
  if (fromEnv?.trim()) return fromEnv.trim();
  if (spec.provider !== "ollama") {
    warnMissingApiKey(spec.provider, envName, opts?.warningSink);
  }
  return undefined;
}

export function modelPortId(spec: ModelSpec): string {
  return `${spec.provider}/${spec.model}`;
}

/** Host origin for Ollama management routes (`/api/tags`, etc.). */
export function ollamaOrigin(baseURL?: string): string {
  let raw = (baseURL?.trim() || "http://127.0.0.1:11434").replace(/\/+$/, "");
  if (raw.endsWith("/api")) raw = raw.slice(0, -4);
  return raw;
}

/** Base URL passed to `createOllama` (includes `/api` suffix). */
export function normalizeOllamaBaseURL(baseURL?: string): string {
  const origin = ollamaOrigin(baseURL);
  return `${origin}/api`;
}

function mergeHeaders(spec: ModelSpec, apiKey?: string): Record<string, string> | undefined {
  const headers = { ...spec.headers };
  if (apiKey && !headers.Authorization && !headers.authorization) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return Object.keys(headers).length ? headers : undefined;
}

export function resolveAnthropicBaseURL(
  spec: Pick<ModelSpec, "baseURL">,
  env: Record<string, string | undefined>,
): string | undefined {
  return spec.baseURL?.trim() || env.ANTHROPIC_BASE_URL?.trim() || undefined;
}

export function createLanguageModel(
  spec: ModelSpec,
  opts: { env: Record<string, string | undefined>; fetch?: typeof fetch; warningSink?: ModelWarningSink },
): LanguageModel {
  const apiKey = resolveApiKey(spec, opts.env, { warningSink: opts.warningSink });
  const headers = mergeHeaders(spec, apiKey);
  const fetchFn = opts.fetch;

  switch (spec.provider) {
    case "anthropic": {
      const p = createAnthropic({
        apiKey,
        baseURL: resolveAnthropicBaseURL(spec, opts.env),
        headers,
        fetch: fetchFn,
      });
      return p(spec.model);
    }
    case "openai": {
      const p = createOpenAI({ apiKey, baseURL: spec.baseURL, headers, fetch: fetchFn });
      return p(spec.model);
    }
    case "google": {
      const p = createGoogleGenerativeAI({ apiKey, baseURL: spec.baseURL, headers, fetch: fetchFn });
      return p(spec.model);
    }
    case "deepseek": {
      const p = createDeepSeek({ apiKey, baseURL: spec.baseURL, headers, fetch: fetchFn });
      return p(spec.model);
    }
    case "ollama": {
      const p = createOllama({
        baseURL: normalizeOllamaBaseURL(spec.baseURL),
        headers,
        fetch: fetchFn,
        compatibility: "strict",
      });
      return p(spec.model);
    }
    case "openai-compatible": {
      if (!spec.baseURL?.trim()) {
        throw new AnimaeError("MODEL_CONFIG", "openai-compatible provider requires baseURL");
      }
      const name = spec.name?.trim() || "openai-compatible";
      const p = createOpenAICompatible({
        name,
        baseURL: spec.baseURL,
        apiKey: apiKey ?? "",
        headers,
        fetch: fetchFn,
      });
      return p(spec.model);
    }
    default: {
      const _exhaustive: never = spec.provider;
      throw new AnimaeError("MODEL_CONFIG", `Unknown provider: ${String(_exhaustive)}`);
    }
  }
}
