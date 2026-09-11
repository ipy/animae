import { stripThinkingArtifacts } from "./reasoning.ts";

type JsonObject = Record<string, unknown>;

/** Pull the first balanced `{…}` JSON object from free text (for reasoning-only completions). */
export function extractJsonObjectFromText(text: string): string | undefined {
  const start = text.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return undefined;
}

function reasoningTextFromMessage(msg: JsonObject): string {
  const parts: string[] = [];
  if (typeof msg.reasoning === "string") parts.push(msg.reasoning);
  const details = msg.reasoning_details;
  if (Array.isArray(details)) {
    for (const d of details) {
      if (d && typeof d === "object" && typeof (d as { text?: string }).text === "string") {
        parts.push((d as { text: string }).text);
      }
    }
  }
  return parts.join("\n");
}

/** OpenAI-style chat message: promote `reasoning` into `content` when content is empty; strip reasoning fields. */
export function normalizeAssistantMessage(msg: JsonObject): void {
  const content = msg.content;
  const hasContent = typeof content === "string" && content.trim().length > 0;
  if (hasContent) {
    delete msg.reasoning;
    delete msg.reasoning_details;
    return;
  }
  const combined = stripThinkingArtifacts(reasoningTextFromMessage(msg));
  if (combined) {
    const json = extractJsonObjectFromText(combined);
    msg.content = json ?? combined;
  } else if (content == null) {
    msg.content = "";
  }
  delete msg.reasoning;
  delete msg.reasoning_details;
}

/** Normalize non-streaming `/v1/chat/completions` JSON bodies that use a separate `reasoning` field. */
export function normalizeChatCompletionBody(body: unknown): unknown {
  if (!body || typeof body !== "object") return body;
  const b = body as JsonObject;
  const choices = b.choices;
  if (!Array.isArray(choices)) return body;
  for (const choice of choices) {
    if (!choice || typeof choice !== "object") continue;
    const msg = (choice as JsonObject).message;
    if (msg && typeof msg === "object") normalizeAssistantMessage(msg as JsonObject);
  }
  return body;
}

function isChatCompletionUrl(url: string): boolean {
  return /\/chat\/completions\b/i.test(url) || /\/v1\/messages\b/i.test(url);
}

function requestUrl(input: string | URL | Request): string {
  return typeof input === "string"
    ? input
    : input instanceof URL
      ? input.href
      : typeof input === "object" && input && "url" in input
        ? String((input as Request).url)
        : "";
}

/** Gateways with split `reasoning`/`content` need `reasoning_effort: none` on the wire (AI SDK may not map providerOptions). */
export function injectReasoningEffortNone(init: RequestInit | undefined): RequestInit | undefined {
  if (!init?.body || typeof init.body !== "string") return init;
  try {
    const body = JSON.parse(init.body) as JsonObject;
    if (body.reasoning_effort != null || body.reasoning != null) return init;
    body.reasoning_effort = "none";
    return { ...init, body: JSON.stringify(body) };
  } catch {
    return init;
  }
}

/**
 * Fetch wrapper: when the upstream returns `message.reasoning` with empty `content`,
 * promote JSON (or cleaned text) into `content` so structured output + narration work.
 */
export function createReasoningAwareFetch(baseFetch: typeof fetch = fetch): typeof fetch {
  const wrapped = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = requestUrl(input);
    const outboundInit = isChatCompletionUrl(url) ? injectReasoningEffortNone(init) : init;
    const res = await baseFetch(input, outboundInit);
    if (!isChatCompletionUrl(url)) return res;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("json")) return res;
    let parsed: unknown;
    try {
      parsed = await res.clone().json();
    } catch {
      return res;
    }
    const normalized = normalizeChatCompletionBody(parsed);
    if (normalized === parsed) return res;
    const headers = new Headers(res.headers);
    headers.set("content-type", "application/json");
    return new Response(JSON.stringify(normalized), {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  };
  if (typeof baseFetch.preconnect === "function") {
    return Object.assign(wrapped, { preconnect: baseFetch.preconnect.bind(baseFetch) }) as typeof fetch;
  }
  return wrapped as typeof fetch;
}

export function chainReasoningFetch(outer: typeof fetch | undefined, inner: typeof fetch = fetch): typeof fetch {
  const base = outer ?? inner;
  return createReasoningAwareFetch(base);
}
