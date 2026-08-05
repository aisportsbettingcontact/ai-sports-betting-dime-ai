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
 * agentEnv() is an explicit ALLOWLIST, not a process.env spread. The
 * subprocess can be granted Bash via allowedTools, and every var in its
 * env is readable from there — so server secrets (DATABASE_URL, Stripe,
 * Discord, VSIN/KenPom, session/JWT, cron tokens, …) must never reach
 * the Claude Code subprocess.
 */
import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import { resolveAnthropicConfig } from "./anthropicClient";

export const DIME_AGENT_MODEL =
  process.env.DIME_AGENT_MODEL || "claude-fable-5";

/** Read-only tool set — safe default for analysis/research tasks. */
export const DIME_AGENT_READONLY_TOOLS = [
  "Read",
  "Glob",
  "Grep",
  "WebSearch",
  "WebFetch",
];

/**
 * Vars the Claude Code subprocess may inherit from the parent — process
 * and runtime basics only, copied only when set. Everything else in
 * process.env (secrets included) stays behind. XDG_CACHE_HOME /
 * XDG_CONFIG_HOME are deliberately absent: add one only if the Agent SDK
 * demonstrably fails to start without it.
 */
const AGENT_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "USER",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "TZ",
  "NODE_ENV",
  // Model pin for the child (model is also passed via query() options).
  "DIME_AGENT_MODEL",
] as const;

/**
 * Environment for the Claude Code subprocess: the allowlisted basics
 * above plus Anthropic routing, mirroring the server's credential
 * resolution (see anthropicClient.ts). Never a process.env spread.
 */
export function agentEnv(): NonNullable<Options["env"]> {
  const { apiKey, authToken, baseURL } = resolveAnthropicConfig();
  const env: NonNullable<Options["env"]> = {};
  for (const key of AGENT_ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
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
        result:
          message.subtype === "success"
            ? message.result
            : `Agent error: ${message.subtype}`,
        isError: message.is_error,
        numTurns: message.num_turns,
        totalCostUsd: message.total_cost_usd,
        durationMs: message.duration_ms,
      };
    }
  }
  throw new Error("Agent finished without a result message");
}
