#!/usr/bin/env bun
/**
 * Opt-in live smoke against a local Ollama daemon (slow models OK; keep calls tiny).
 * Usage:
 *   OLLAMA_MODEL=huihui_ai/gemma-4-abliterated:latest bun run smoke:ollama
 *   bun run smoke:ollama -- --model llama3.2 --baseURL http://127.0.0.1:11434
 */
import { generateText } from "ai";
import { z } from "zod";
import type { ModelPort } from "../src/ports.ts";
import type { ModelSpec } from "../src/schema/authored.ts";
import {
  createLanguageModel,
  createMemoryModelWarningSink,
  createModelsFromConfig,
  installAiSdkWarningHandler,
  registerModelWarningSink,
  resetModelWarningState,
  resolveApiKey,
  sanitizeStructuredOutput,
  stripThinkingArtifacts,
  type ModelWarningEntry,
} from "../src/model/index.ts";

const pingSchema = z.object({ ok: z.literal(true) });
const narrSchema = z.object({ text: z.string().max(200) });

type Row = { name: string; pass: boolean; ms: number; detail?: string };

function parseArgs() {
  const argv = process.argv.slice(2);
  let model = process.env.OLLAMA_MODEL?.trim() || "huihui_ai/gemma-4-abliterated:latest";
  let baseURL = process.env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434";
  for (let i = 0; i < argv.length; i++) {
    const next = argv[i + 1];
    if (argv[i] === "--model" && next) model = next;
    if (argv[i] === "--baseURL" && next) baseURL = next;
  }
  return { model, baseURL };
}

function spec(model: string, baseURL: string, options?: Record<string, unknown>): ModelSpec {
  return { provider: "ollama", model, baseURL, options };
}

function wrapTimed(port: ModelPort): ModelPort {
  return {
    id: port.id,
    usage: () => port.usage?.() ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    async object(req) {
      return port.object(req);
    },
    stream(req) {
      return port.stream(req);
    },
  };
}

async function timedObject(port: ModelPort, req: Parameters<ModelPort["object"]>[0]) {
  const t0 = performance.now();
  try {
    const value = await port.object(req);
    return { value, ms: performance.now() - t0 };
  } catch (e) {
    return { error: e, ms: performance.now() - t0 };
  }
}

async function timedStream(port: ModelPort, req: Parameters<ModelPort["stream"]>[0]) {
  const t0 = performance.now();
  const parts = [];
  try {
    for await (const p of port.stream(req)) parts.push(p);
    return { parts, ms: performance.now() - t0 };
  } catch (e) {
    return { error: e, parts, ms: performance.now() - t0 };
  }
}

function routeAiSdkWarnings(options: {
  warnings: { type: string; message?: string }[];
  provider?: string;
  model?: string;
}) {
  if (options.warnings.length === 0) return;
  const logger = globalThis.AI_SDK_LOG_WARNINGS;
  if (logger === false) return;
  if (typeof logger === "function") logger(options as never);
}

async function main() {
  const { model, baseURL } = parseArgs();
  const rows: Row[] = [];
  const warnings: ModelWarningEntry[] = [];
  resetModelWarningState();
  installAiSdkWarningHandler();
  registerModelWarningSink(createMemoryModelWarningSink(warnings));

  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((c: string | Uint8Array) => {
    stdoutChunks.push(String(c));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((c: string | Uint8Array) => {
    stderrChunks.push(String(c));
    return true;
  }) as typeof process.stderr.write;

  const baseSpec = spec(model, baseURL, { think: false, num_predict: 32 });
  const config = {
    seed: 0,
    policies: [] as string[],
    models: { s1: baseSpec, s2: baseSpec },
  };

  let ports: { s1: ModelPort; s2: ModelPort };
  try {
    ports = createModelsFromConfig(config, { env: {} });
  } catch (e) {
    console.error("createModelsFromConfig failed:", e);
    process.exit(1);
  }
  const port = wrapTimed(ports.s1);

  // (a) plain text via same LanguageModel path as ports
  {
    const lm = createLanguageModel(baseSpec, { env: {} });
    const t0 = performance.now();
    try {
      const out = await generateText({
        model: lm,
        prompt: "Reply with exactly the word OK.",
        maxOutputTokens: 16,
        temperature: 0,
        providerOptions: { ollama: { think: false, num_predict: 16 } },
      });
      const text = stripThinkingArtifacts(out.text).trim();
      rows.push({
        name: "plain text",
        pass: /ok/i.test(text),
        ms: performance.now() - t0,
        detail: text.slice(0, 80),
      });
    } catch (e) {
      rows.push({ name: "plain text", pass: false, ms: performance.now() - t0, detail: String(e) });
    }
  }

  // (b) streaming structured
  {
    const r = await timedStream(port, {
      label: "smoke.stream",
      segments: { static: "Return JSON only.", semiStatic: "", dynamic: "", user: "ping", history: [] },
      maxOutputTokens: 48,
      temperature: 0,
      schema: pingSchema,
    });
    const fin = r.parts?.find((p) => p.type === "final");
    const ok = fin?.type === "final" && (fin.value as { ok?: boolean }).ok === true;
    rows.push({
      name: "stream + schema",
      pass: ok && !r.error,
      ms: r.ms,
      detail: r.error ? String(r.error) : undefined,
    });
  }

  // (c) structured object + repair path
  {
    const r = await timedObject(port, {
      label: "smoke.object",
      segments: { static: 'Reply JSON {"ok":true} only.', semiStatic: "", dynamic: "", user: "ping", history: [] },
      maxOutputTokens: 48,
      temperature: 0,
      schema: pingSchema,
    });
    rows.push({
      name: "object + zod",
      pass: !("error" in r) && (r.value as { ok?: boolean } | undefined)?.ok === true,
      ms: r.ms,
      detail: "error" in r ? String(r.error) : undefined,
    });
  }

  // (d) thinking on vs off (narration field)
  for (const think of [false, true] as const) {
    const thinkSpec = spec(model, baseURL, { think, num_predict: 64 });
    const thinkPort = createModelsFromConfig(
      { seed: 0, policies: [], models: { s1: thinkSpec, s2: thinkSpec } },
      { env: {} },
    ).s1;
    const r = await timedObject(thinkPort, {
      label: `smoke.think.${think}`,
      segments: {
        static: "Two short sentences of calm greenhouse narration.",
        semiStatic: "",
        dynamic: "",
        user: "Describe morning light.",
        history: [],
      },
      maxOutputTokens: 96,
      temperature: 0.3,
      schema: narrSchema,
    });
    const text =
      "value" in r && r.value ? sanitizeStructuredOutput(r.value as { text: string }).text : "";
    const stripped = stripThinkingArtifacts(text);
    const hasThinkTag = /<\s*(redacted_)?think/i.test(text);
    rows.push({
      name: `think=${think}`,
      pass: !("error" in r) && stripped.length > 0 && !hasThinkTag,
      ms: r.ms,
      detail: stripped.slice(0, 100),
    });
  }

  // (e) AI SDK warning sink (no stdout/stderr)
  {
    routeAiSdkWarnings({
      warnings: [{ type: "other", message: "smoke-once" }],
      provider: "ollama",
      model,
    });
    routeAiSdkWarnings({
      warnings: [{ type: "other", message: "smoke-once" }],
      provider: "ollama",
      model,
    });
    const sdkCaptured = warnings.filter((w) => w.message.includes("smoke-once")).length === 1;
    rows.push({
      name: "warning sink",
      pass: sdkCaptured && stdoutChunks.join("") === "" && stderrChunks.join("") === "",
      ms: 0,
      detail: sdkCaptured ? "captured, silent stdio" : "missing capture or stdio leak",
    });
  }

  // (f) missing API key tolerance (ollama silent; hosted warns once)
  {
    const hostedWarns: ModelWarningEntry[] = [];
    const hostedSink = createMemoryModelWarningSink(hostedWarns);
    const ollamaKey = resolveApiKey({ provider: "ollama", model }, {}, { warningSink: hostedSink });
    resolveApiKey({ provider: "openai", model: "gpt" }, {}, { warningSink: hostedSink });
    resolveApiKey({ provider: "openai", model: "gpt" }, {}, { warningSink: hostedSink });
    const hostedOnce = hostedWarns.filter((w) => w.code === "MODEL_API_KEY_MISSING").length === 1;
    rows.push({
      name: "missing key",
      pass: ollamaKey === undefined && hostedOnce,
      ms: 0,
    });
  }

  process.stdout.write = origOut;
  process.stderr.write = origErr;

  console.log(`\nOllama smoke  model=${model}  baseURL=${baseURL}\n`);
  console.log("| check | PASS | ms | detail |");
  console.log("|-------|------|-----|--------|");
  for (const r of rows) {
    console.log(`| ${r.name} | ${r.pass ? "PASS" : "FAIL"} | ${r.ms.toFixed(0)} | ${(r.detail ?? "").replace(/\|/g, "/").slice(0, 60)} |`);
  }
  const failed = rows.filter((r) => !r.pass).length;
  console.log(`\nports.s1.usage: ${JSON.stringify(port.usage?.() ?? {})}`);
  process.exit(failed ? 1 : 0);
}

await main();
