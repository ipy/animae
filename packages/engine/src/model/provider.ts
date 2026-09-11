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
import { chainReasoningFetch } from "./reasoning-fetch.ts";

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

/** Default Ollama context window when `options.num_ctx` is omitted (Ollama often defaults to 2048–4096 and truncates silently). */
export const DEFAULT_OLLAMA_NUM_CTX = 8192;

/** Merge authored `spec.options` with engine defaults for Ollama `/api/chat` `options`. */
export function resolveOllamaProviderOptions(spec: ModelSpec): Record<string, unknown> {
  const opts = { ...(spec.options ?? {}) };
  if (opts.num_ctx == null) opts.num_ctx = DEFAULT_OLLAMA_NUM_CTX;
  return opts;
}

/**
 * OpenAI-compatible gateways that emit a separate `reasoning` field can exhaust `max_tokens` on thinking
 * and return empty structured `content`. Default `reasoning_effort: none` unless the host opts in.
 */
export function resolveOpenAICompatibleProviderOptions(spec: ModelSpec): Record<string, unknown> {
  const opts = { ...(spec.options ?? {}) };
  if (opts.reasoning_effort == null && opts.reasoning == null) opts.reasoning_effort = "none";
  return opts;
}

function mergeHeaders(spec: ModelSpec, apiKey?: string): Record<string, string> | undefined {
  const headers = { ...spec.headers };
  if (apiKey && !headers.Authorization && !headers.authorization) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return Object.keys(headers).length ? headers : undefined;
}

/**
 * Anthropic gateways are conventionally configured with the *origin or prefix without `/v1`* (that is how the
 * official SDKs and `ANTHROPIC_BASE_URL` behave: they append `/v1/messages` themselves), but the AI SDK provider
 * appends only `/messages` to its `baseURL`. Normalise so both spellings work:
 *
 * - `https://gw.example/anthropic`        → `https://gw.example/anthropic/v1`
 * - `https://gw.example/anthropic/v1`     → unchanged
 * - `https://gw.example/anthropic/v1/messages` (pasted endpoint) → `https://gw.example/anthropic/v1`
 */
export function normalizeAnthropicBaseURL(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
  let pathname = url.pathname.replace(/\/+$/, "");
  if (/\/messages$/i.test(pathname)) pathname = pathname.replace(/\/messages$/i, "");
  if (!/\/v\d+$/i.test(pathname)) pathname = `${pathname}/v1`;
  url.pathname = pathname;
  url.hash = "";
  return url.toString();
}

export function resolveAnthropicBaseURL(
  spec: Pick<ModelSpec, "baseURL">,
  env: Record<string, string | undefined>,
): string | undefined {
  return normalizeAnthropicBaseURL(spec.baseURL?.trim() || env.ANTHROPIC_BASE_URL?.trim() || undefined);
}

export function createLanguageModel(
  spec: ModelSpec,
  opts: { env: Record<string, string | undefined>; fetch?: typeof fetch; warningSink?: ModelWarningSink },
): LanguageModel {
  const apiKey = resolveApiKey(spec, opts.env, { warningSink: opts.warningSink });
  const headers = mergeHeaders(spec, apiKey);
  const needsReasoningFetch =
    spec.provider === "openai-compatible" || spec.provider === "deepseek" || spec.provider === "openai";
  const fetchFn = needsReasoningFetch ? chainReasoningFetch(opts.fetch) : opts.fetch;

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
