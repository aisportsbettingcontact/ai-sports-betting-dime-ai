/**
 * Dime 1.0 client — OpenAI-compatible chat completions over HTTPS.
 * ---------------------------------------------------------------
 * v1 architecture: Railway is the control plane (auth, entitlement, rate
 * limits, retrieval, prompt construction, deterministic math, response
 * validation, logging). The GPU execution plane is a private RunPod
 * Serverless endpoint running vLLM with the 4-bit Dime 1.0 checkpoint.
 * Runbook: ml/dime-1.0/README.md
 *
 * Endpoint resolution (first match wins):
 *   DIME_MODEL_BASE_URL     → full OpenAI-compatible base URL including /v1
 *                         (local dev, e.g. http://127.0.0.1:8000/v1)
 *   RUNPOD_ENDPOINT_ID  → https://api.runpod.ai/v2/<id>/openai/v1
 *
 * Bearer token (first match wins — only one is ever sent):
 *   DIME_MODEL_API_SECRET → private load-balancing endpoint secret
 *   RUNPOD_API_KEY        → RunPod account API key (serverless vLLM worker)
 *
 * Served model name: DIME_MODEL_VERSION (e.g. "dime-1.0-v1.0.0"), falling
 * back to "dime-1.0". Must match the endpoint's served model name so a
 * version mismatch fails loudly instead of silently answering from the
 * wrong checkpoint.
 */

import { DIME1_DEFAULT_SERVED_MODEL } from "./dime1Model";

export type Dime1Env = Record<string, string | undefined>;

export interface Dime1Config {
  /** OpenAI-compatible base URL, no trailing slash, includes /v1. */
  baseUrl: string;
  bearerToken?: string;
  model: string;
  timeoutMs: number;
  source: "explicit" | "runpod";
}

const DIME1_DEFAULT_TIMEOUT_MS = 60_000;

function readEnv(env: Dime1Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

export function resolveDime1Config(env: Dime1Env = process.env): Dime1Config | null {
  const explicitBase = readEnv(env, "DIME_MODEL_BASE_URL");
  const endpointId = readEnv(env, "RUNPOD_ENDPOINT_ID");
  const baseUrl = explicitBase ?? (endpointId ? `https://api.runpod.ai/v2/${endpointId}/openai/v1` : undefined);
  if (!baseUrl) return null;

  const timeoutRaw = Number(readEnv(env, "DIME_MODEL_TIMEOUT_MS"));
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    bearerToken: readEnv(env, "DIME_MODEL_API_SECRET") ?? readEnv(env, "RUNPOD_API_KEY"),
    model: readEnv(env, "DIME_MODEL_VERSION") ?? DIME1_DEFAULT_SERVED_MODEL,
    timeoutMs: Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : DIME1_DEFAULT_TIMEOUT_MS,
    source: explicitBase ? "explicit" : "runpod",
  };
}

export function isDime1Configured(env: Dime1Env = process.env): boolean {
  return resolveDime1Config(env) !== null;
}

export class Dime1ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "Dime1ApiError";
    this.status = status;
  }
}

export interface Dime1ChatParams {
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  maxTokens: number;
  temperature?: number;
  stop?: string[];
  signal?: AbortSignal;
}

export interface Dime1ChatResult {
  content: string;
  finishReason: string | null;
  model: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
}

interface OpenAiChatCompletionResponse {
  model?: string;
  choices?: { message?: { content?: string | null }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

export async function dime1ChatComplete(
  params: Dime1ChatParams,
  env: Dime1Env = process.env,
): Promise<Dime1ChatResult> {
  const config = resolveDime1Config(env);
  if (!config) {
    throw new Error(
      "Dime 1.0 endpoint is not configured. Set RUNPOD_ENDPOINT_ID (+ DIME_MODEL_API_SECRET or RUNPOD_API_KEY), or DIME_MODEL_BASE_URL for a custom endpoint.",
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const onParentAbort = () => controller.abort();
  params.signal?.addEventListener("abort", onParentAbort, { once: true });

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.bearerToken ? { Authorization: `Bearer ${config.bearerToken}` } : {}),
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: "system", content: params.system }, ...params.messages],
        max_tokens: params.maxTokens,
        temperature: params.temperature ?? 0.2,
        ...(params.stop && params.stop.length > 0 ? { stop: params.stop } : {}),
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Dime1ApiError(response.status, `Dime 1.0 endpoint returned ${response.status}: ${body.slice(0, 300)}`);
    }

    const json = (await response.json()) as OpenAiChatCompletionResponse;
    const choice = json.choices?.[0];
    const content = choice?.message?.content;
    if (typeof content !== "string" || content.length === 0) {
      throw new Dime1ApiError(502, "Dime 1.0 endpoint returned no message content");
    }

    const result: Dime1ChatResult = {
      content,
      finishReason: choice?.finish_reason ?? null,
      model: json.model ?? config.model,
    };
    if (json.usage) {
      result.usage = {
        promptTokens: json.usage.prompt_tokens,
        completionTokens: json.usage.completion_tokens,
        totalTokens: json.usage.total_tokens,
      };
    }
    return result;
  } finally {
    clearTimeout(timeout);
    params.signal?.removeEventListener("abort", onParentAbort);
  }
}
