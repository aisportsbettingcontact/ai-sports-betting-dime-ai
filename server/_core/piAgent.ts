/**
 * Pi Agent — embedded @earendil-works/pi-agent-core runtime
 * ---------------------------------------------------------------
 * In-process counterpart to dimeAgent.ts. Where the Claude Agent SDK spawns
 * Claude Code as a subprocess with its own built-in tools, pi-agent-core runs
 * a stateful Agent inside this server: app-defined AgentTools, streamed
 * lifecycle events (message_update deltas for SSE), steering/follow-up
 * queues, and no child process.
 *
 * Credential resolution matches the rest of the server (anthropicClient.ts):
 * pi-ai's Anthropic provider reads the same env vars in the same order —
 * ANTHROPIC_AUTH_TOKEN (Authorization: Bearer, gateway) first, then
 * ANTHROPIC_API_KEY (x-api-key, direct) — so no key plumbing is needed here.
 * Gateway host routing is applied per-model: the catalog model's baseUrl is
 * overridden with ANTHROPIC_BASE_URL when set. OpenAI providers resolve
 * OPENAI_API_KEY (openai) / Codex OAuth (openai-codex) when configured.
 *
 * Model policy (LLM.md): current-generation models only — claude-fable-5 or
 * claude-opus-5 for Anthropic, gpt-5.6-sol for Codex. Older models throw
 * unless DIME_ALLOW_LEGACY_MODELS=1 (e.g. for one-off comparisons).
 */
import { Agent, type AgentMessage, type AgentTool, type ThinkingLevel } from "@earendil-works/pi-agent-core";
import { createModels, type Api, type Model, type Usage } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { resolveAnthropicConfig } from "./anthropicClient";
import { DIME_AGENT_MODEL } from "./dimeAgent";

const models = createModels();
models.setProvider(anthropicProvider());
models.setProvider(openaiProvider());
models.setProvider(openaiCodexProvider());

/** Current-generation allowlist, as "provider/id". See LLM.md. */
export const PI_AGENT_APPROVED_MODELS = [
  "anthropic/claude-fable-5",
  "anthropic/claude-opus-5",
  "openai-codex/gpt-5.6-sol",
] as const;

function allowLegacyModels(): boolean {
  return process.env.DIME_ALLOW_LEGACY_MODELS === "1";
}

/**
 * Resolve a model from pi-ai's catalog. Accepts a bare Anthropic id
 * ("claude-fable-5") or a "provider/id" ref ("openai-codex/gpt-5.6-sol").
 * Anthropic models are rerouted through the gateway when ANTHROPIC_BASE_URL
 * is set. Enforces the current-generation model policy.
 */
export function resolvePiAgentModel(ref: string = DIME_AGENT_MODEL): Model<Api> {
  const slash = ref.indexOf("/");
  const provider = slash === -1 ? "anthropic" : ref.slice(0, slash);
  const id = slash === -1 ? ref : ref.slice(slash + 1);

  if (!PI_AGENT_APPROVED_MODELS.includes(`${provider}/${id}` as (typeof PI_AGENT_APPROVED_MODELS)[number]) && !allowLegacyModels()) {
    throw new Error(
      `Model "${provider}/${id}" is outside the current-generation policy (${PI_AGENT_APPROVED_MODELS.join(", ")}). ` +
        `Set DIME_ALLOW_LEGACY_MODELS=1 to override. See LLM.md.`,
    );
  }

  const model = models.getModel(provider, id);
  if (!model) {
    throw new Error(`pi-ai has no model "${provider}/${id}" — check DIME_AGENT_MODEL or pass a catalog ref`);
  }
  if (provider === "anthropic") {
    const { baseURL } = resolveAnthropicConfig();
    if (baseURL) return { ...model, baseUrl: baseURL };
  }
  return model;
}

export interface CreatePiAgentParams {
  systemPrompt: string;
  /** Bare Anthropic id or "provider/id" ref. Defaults to DIME_AGENT_MODEL (claude-fable-5, or DIME_AGENT_MODEL env). */
  model?: string;
  /** App-defined tools; pi-agent-core ships none built in. */
  tools?: AgentTool[];
  thinkingLevel?: ThinkingLevel;
  /** Forwarded to the provider for session-based prompt caching. */
  sessionId?: string;
}

/**
 * Configured stateful agent. Callers own the lifecycle: subscribe() for
 * events (stream `message_update` text deltas to SSE), prompt()/steer()/
 * followUp() to drive it, abort() to cancel.
 */
export function createPiAgent({
  systemPrompt,
  model = DIME_AGENT_MODEL,
  tools = [],
  thinkingLevel,
  sessionId,
}: CreatePiAgentParams): Agent {
  return new Agent({
    initialState: {
      systemPrompt,
      model: resolvePiAgentModel(model),
      tools,
      ...(thinkingLevel ? { thinkingLevel } : {}),
    },
    streamFn: models.streamSimple.bind(models),
    ...(sessionId ? { sessionId } : {}),
  });
}

export interface RunPiAgentParams extends CreatePiAgentParams {
  prompt: string;
  signal?: AbortSignal;
}

/** Mirrors DimeAgentResult (dimeAgent.ts) so call sites can swap runtimes. */
export interface PiAgentResult {
  result: string;
  isError: boolean;
  numTurns: number;
  totalCostUsd: number;
  durationMs: number;
}

// ---------------------------------------------------------------
// Chat serving (Dime Chat "pi" provider — dime-chat.route.ts)
// ---------------------------------------------------------------

export interface PiChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface RunPiChatParams {
  systemPrompt: string;
  /** Full turn history; must end with the user message to answer. */
  history: PiChatTurn[];
  /** Bare Anthropic id or "provider/id" ref. */
  model?: string;
  maxTokens?: number;
  signal?: AbortSignal;
  sessionId?: string;
}

export interface PiChatResult {
  text: string;
  stopReason: string;
  model: string;
  usage: { inputTokens: number | null; outputTokens: number | null };
}

function toAgentHistory(turns: PiChatTurn[], model: Model<Api>): AgentMessage[] {
  const zeroUsage: Usage = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  return turns.map((turn, index) =>
    turn.role === "user"
      ? { role: "user", content: turn.content, timestamp: index }
      : {
          role: "assistant",
          content: [{ type: "text", text: turn.content }],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: zeroUsage,
          stopReason: "stop",
          timestamp: index,
        },
  );
}

/**
 * Serve one chat completion through the embedded pi runtime: seeded history,
 * capped output tokens, no tools. Throws on provider errors so callers keep
 * their own error contract.
 */
export async function runPiChat({
  systemPrompt,
  history,
  model = DIME_AGENT_MODEL,
  maxTokens,
  signal,
  sessionId,
}: RunPiChatParams): Promise<PiChatResult> {
  const last = history[history.length - 1];
  if (!last || last.role !== "user") {
    throw new Error("runPiChat: history must end with a user message");
  }
  const resolved = resolvePiAgentModel(model);
  const agent = new Agent({
    initialState: {
      systemPrompt,
      model: resolved,
      tools: [],
      messages: toAgentHistory(history.slice(0, -1), resolved),
    },
    streamFn: (streamModel, context, options) =>
      models.streamSimple(streamModel, context, { ...options, ...(maxTokens ? { maxTokens } : {}) }),
    ...(sessionId ? { sessionId } : {}),
  });
  const onAbort = () => agent.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    await agent.prompt(last.content);
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }

  const reply = agent.state.messages.filter((m) => m.role === "assistant").at(-1);
  const errorMessage = agent.state.errorMessage ?? reply?.errorMessage;
  if (errorMessage) throw new Error(errorMessage);
  if (!reply) throw new Error("runPiChat: no assistant reply produced");
  return {
    text: reply.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join(""),
    stopReason: reply.stopReason,
    model: reply.model,
    usage: {
      inputTokens: reply.usage?.input ?? null,
      outputTokens: reply.usage?.output ?? null,
    },
  };
}

/**
 * Run a single task to completion and return the final result — the
 * pi-agent-core equivalent of runDimeAgent().
 */
export async function runPiAgent({ prompt, signal, ...params }: RunPiAgentParams): Promise<PiAgentResult> {
  const agent = createPiAgent(params);
  const onAbort = () => agent.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const startedAt = Date.now();
  try {
    await agent.prompt(prompt);
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }

  const assistantMessages = agent.state.messages.filter((m) => m.role === "assistant");
  const last = assistantMessages[assistantMessages.length - 1];
  const text = last?.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("");
  const errorMessage = agent.state.errorMessage ?? last?.errorMessage;
  return {
    result: errorMessage ? `Agent error: ${errorMessage}` : (text ?? ""),
    isError: Boolean(errorMessage),
    numTurns: assistantMessages.length,
    totalCostUsd: assistantMessages.reduce((sum, m) => sum + (m.usage?.cost.total ?? 0), 0),
    durationMs: Date.now() - startedAt,
  };
}
