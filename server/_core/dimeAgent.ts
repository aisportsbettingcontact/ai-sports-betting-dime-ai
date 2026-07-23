/**
 * Dime Agent — Claude Agent SDK runner
 * ---------------------------------------------------------------
 * Wraps `query()` from @anthropic-ai/claude-agent-sdk so agentic
 * tasks (multi-step tool use: Read/Grep/Bash/WebSearch…) share the
 * same Anthropic credentials as the rest of the server, including
 * Anthropic-compatible gateway routing.
 *
 * The Agent SDK spawns Claude Code as a subprocess, so routing is
 * controlled entirely through environment variables on that child
 * process (built by agentEnv() below):
 *   ANTHROPIC_BASE_URL   — gateway host, e.g. an Anthropic-compatible gateway
 *   ANTHROPIC_AUTH_TOKEN — gateway API key (Authorization: Bearer)
 *   ANTHROPIC_API_KEY    — must be EMPTY when using the gateway token;
 *                          Claude Code checks it first and it would win.
 *
 */
import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import { resolveAnthropicConfig } from "./anthropicClient";

export const DIME_AGENT_MODEL = process.env.DIME_AGENT_MODEL || "claude-fable-5";

/** Read-only tool set — safe default for analysis/research tasks. */
export const DIME_AGENT_READONLY_TOOLS = ["Read", "Glob", "Grep", "WebSearch", "WebFetch"];

/**
 * Environment for the Claude Code subprocess, mirroring the server's
 * credential resolution (see anthropicClient.ts).
 */
export function agentEnv(): NonNullable<Options["env"]> {
  const { apiKey, authToken, baseURL } = resolveAnthropicConfig();
  const env: NonNullable<Options["env"]> = { ...process.env };
  if (baseURL) env.ANTHROPIC_BASE_URL = baseURL;
  if (authToken) {
    env.ANTHROPIC_AUTH_TOKEN = authToken;
    env.ANTHROPIC_API_KEY = ""; // empty, not unset — Claude Code checks this var first
  } else if (apiKey) {
    env.ANTHROPIC_API_KEY = apiKey;
  }
  return env;
}

export interface RunDimeAgentParams {
  prompt: string;
  /** Defaults to DIME_AGENT_MODEL (claude-fable-5, or DIME_AGENT_MODEL env). */
  model?: string;
  /** Defaults to the read-only tool set. Pass e.g. ["Read","Edit","Bash"] to allow writes. */
  allowedTools?: string[];
  systemPrompt?: string;
  /** Working directory the agent's file tools operate in. */
  cwd?: string;
  abortController?: AbortController;
}

export interface DimeAgentResult {
  result: string;
  isError: boolean;
  numTurns: number;
  totalCostUsd: number;
  durationMs: number;
}

/**
 * Run a single agentic task to completion and return the final result.
 * For chat-style streaming keep using streamClaude()/dime-chat.route.ts —
 * the Agent SDK is for multi-step tool-using tasks, not token streaming.
 */
export async function runDimeAgent({
  prompt,
  model = DIME_AGENT_MODEL,
  allowedTools = DIME_AGENT_READONLY_TOOLS,
  systemPrompt,
  cwd,
  abortController,
}: RunDimeAgentParams): Promise<DimeAgentResult> {
  for await (const message of query({
    prompt,
    options: {
      model,
      allowedTools,
      env: agentEnv(),
      ...(systemPrompt ? { systemPrompt } : {}),
      ...(cwd ? { cwd } : {}),
      ...(abortController ? { abortController } : {}),
    },
  })) {
    if (message.type === "result") {
      return {
        result: message.subtype === "success" ? message.result : `Agent error: ${message.subtype}`,
        isError: message.is_error,
        numTurns: message.num_turns,
        totalCostUsd: message.total_cost_usd,
        durationMs: message.duration_ms,
      };
    }
  }
  throw new Error("Agent finished without a result message");
}
