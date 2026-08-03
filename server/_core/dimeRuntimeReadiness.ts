import {
  DIME_ANSWER_ROUTING_VERSION,
  isDimeAnswerRoutingEnabled,
} from "./dimeAnswerRouting";
import { resolveDime1Config, type Dime1Env } from "./dime1Client";
import {
  DIME_CHAT_LLM_PROVIDER,
  type DimeChatLlmProvider,
} from "./dimeChatModel";
import {
  DIME_PLATFORM_KNOWLEDGE_SHA256,
  DIME_PLATFORM_KNOWLEDGE_VERSION,
} from "./dimePlatformKnowledge";
import {
  resolveDimeResearchAlphaGate,
  type DimeResearchAlphaInactiveReason,
} from "./dimeResearchAlpha";
import {
  DIME_CHAT_TRACE_POLICY_VERSION,
  DIME_CHAT_TRACE_VERSION,
  isDimeChatTraceEnabled,
} from "../dimeChatTrace";

export const DIME_RUNTIME_READINESS_VERSION =
  "dime-chat-runtime-readiness-v1" as const;

export type DimeRuntimeMode =
  | "frozen"
  | "research-alpha"
  | "dime1"
  | "anthropic"
  | "pi";

export type DimeRuntimeConfigurationState =
  | "configured"
  | "incomplete"
  | "limited"
  | "offline";

export type DimeRuntimeIssueCode =
  | "provider_frozen"
  | "answer_routing_disabled"
  | "answer_routing_config_invalid"
  | "trace_disabled"
  | "research_alpha_config_incomplete"
  | "dime_endpoint_missing"
  | "dime_endpoint_credential_missing"
  | "anthropic_credentials_missing";

export interface DimeRuntimeReadiness {
  version: typeof DIME_RUNTIME_READINESS_VERSION;
  generatedAt: string;
  state: DimeRuntimeConfigurationState;
  mode: DimeRuntimeMode;
  capabilities: {
    generativeLaneConfigured: boolean;
    deterministicResponsesConfigured: boolean;
    serverAuthoritativeTraceConfigured: boolean;
  };
  provider: {
    configured: DimeChatLlmProvider;
    frozen: boolean;
  };
  answerRouting: {
    version: typeof DIME_ANSWER_ROUTING_VERSION;
    enabled: boolean;
    source: "default" | "environment";
    configuredValueValid: boolean;
    defaultWhenUnset: true;
  };
  trace: {
    version: typeof DIME_CHAT_TRACE_VERSION;
    policyVersion: typeof DIME_CHAT_TRACE_POLICY_VERSION;
    enabled: boolean;
    source: "default" | "environment";
  };
  researchAlpha: {
    active: boolean;
    requested: boolean;
    killSwitchEngaged: boolean;
    reason?: DimeResearchAlphaInactiveReason;
  };
  endpoint: {
    configured: boolean;
    credentialConfigured: boolean;
    explicitModelConfigured: boolean;
    source?: "explicit" | "runpod";
  };
  anthropic: {
    credentialConfigured: boolean;
  };
  evidence: {
    platformKnowledgeVersion: typeof DIME_PLATFORM_KNOWLEDGE_VERSION;
    platformKnowledgeSha256: typeof DIME_PLATFORM_KNOWLEDGE_SHA256;
  };
  issues: DimeRuntimeIssueCode[];
}

interface DimeRuntimeReadinessOptions {
  env?: Dime1Env;
  provider?: DimeChatLlmProvider;
  now?: Date;
}

function readEnv(env: Dime1Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function hasAnthropicCredential(env: Dime1Env): boolean {
  return Boolean(
    readEnv(env, "ANTHROPIC_AUTH_TOKEN") || readEnv(env, "ANTHROPIC_API_KEY")
  );
}

export function getDimeRuntimeReadiness(
  options: DimeRuntimeReadinessOptions = {}
): DimeRuntimeReadiness {
  const env = options.env ?? process.env;
  const provider = options.provider ?? DIME_CHAT_LLM_PROVIDER;
  const now = options.now ?? new Date();

  const routingRaw = readEnv(env, "DIME_ANSWER_ROUTING_V1_ENABLED");
  const routingNormalized = routingRaw?.toLowerCase();
  const routingValueValid =
    routingRaw === undefined ||
    routingNormalized === "true" ||
    routingNormalized === "false";
  const answerRoutingEnabled = isDimeAnswerRoutingEnabled(env);

  const traceRaw = readEnv(env, "DIME_CHAT_TRACE_V1_ENABLED");
  const traceEnabled = isDimeChatTraceEnabled(env);

  const alphaEnabled = readEnv(env, "DIME_RESEARCH_ALPHA_ENABLED");
  const alphaKillSwitch = readEnv(env, "DIME_RESEARCH_ALPHA_KILL_SWITCH");
  const alphaRequested = alphaEnabled === "true" || alphaKillSwitch === "false";
  const alphaGate = resolveDimeResearchAlphaGate(env);

  const endpoint = resolveDime1Config(env);
  const endpointCredentialConfigured = Boolean(endpoint?.bearerToken);
  const anthropicCredentialConfigured = hasAnthropicCredential(env);

  const mode: DimeRuntimeMode = alphaGate.active ? "research-alpha" : provider;
  const generativeLaneConfigured =
    alphaGate.active ||
    (provider === "dime1" &&
      endpoint !== null &&
      endpointCredentialConfigured) ||
    ((provider === "anthropic" || provider === "pi") &&
      anthropicCredentialConfigured);

  const issues: DimeRuntimeIssueCode[] = [];
  if (!alphaGate.active && provider === "frozen")
    issues.push("provider_frozen");
  if (!answerRoutingEnabled) issues.push("answer_routing_disabled");
  if (!routingValueValid) issues.push("answer_routing_config_invalid");
  if (!traceEnabled) issues.push("trace_disabled");
  if (alphaRequested && !alphaGate.active) {
    issues.push("research_alpha_config_incomplete");
  }
  if ((alphaRequested || provider === "dime1") && !endpoint) {
    issues.push("dime_endpoint_missing");
  } else if (
    (alphaRequested || provider === "dime1") &&
    !endpointCredentialConfigured
  ) {
    issues.push("dime_endpoint_credential_missing");
  }
  if (
    !alphaGate.active &&
    (provider === "anthropic" || provider === "pi") &&
    !anthropicCredentialConfigured
  ) {
    issues.push("anthropic_credentials_missing");
  }

  let state: DimeRuntimeConfigurationState;
  if (generativeLaneConfigured) {
    state =
      traceEnabled && answerRoutingEnabled && routingValueValid
        ? "configured"
        : "incomplete";
  } else if (answerRoutingEnabled) {
    state = "limited";
  } else {
    state = "offline";
  }

  return {
    version: DIME_RUNTIME_READINESS_VERSION,
    generatedAt: now.toISOString(),
    state,
    mode,
    capabilities: {
      generativeLaneConfigured,
      deterministicResponsesConfigured: answerRoutingEnabled,
      serverAuthoritativeTraceConfigured: traceEnabled,
    },
    provider: {
      configured: provider,
      frozen: provider === "frozen",
    },
    answerRouting: {
      version: DIME_ANSWER_ROUTING_VERSION,
      enabled: answerRoutingEnabled,
      source: routingRaw === undefined ? "default" : "environment",
      configuredValueValid: routingValueValid,
      defaultWhenUnset: true,
    },
    trace: {
      version: DIME_CHAT_TRACE_VERSION,
      policyVersion: DIME_CHAT_TRACE_POLICY_VERSION,
      enabled: traceEnabled,
      source: traceRaw === undefined ? "default" : "environment",
    },
    researchAlpha: {
      active: alphaGate.active,
      requested: alphaRequested,
      killSwitchEngaged: alphaKillSwitch !== "false",
      ...(!alphaGate.active ? { reason: alphaGate.reason } : {}),
    },
    endpoint: {
      configured: endpoint !== null,
      credentialConfigured: endpointCredentialConfigured,
      explicitModelConfigured: Boolean(readEnv(env, "DIME_MODEL_VERSION")),
      ...(endpoint ? { source: endpoint.source } : {}),
    },
    anthropic: {
      credentialConfigured: anthropicCredentialConfigured,
    },
    evidence: {
      platformKnowledgeVersion: DIME_PLATFORM_KNOWLEDGE_VERSION,
      platformKnowledgeSha256: DIME_PLATFORM_KNOWLEDGE_SHA256,
    },
    issues,
  };
}

export function formatDimeRuntimeReadinessLog(
  readiness: DimeRuntimeReadiness
): string {
  return [
    `[DIME_RUNTIME] version=${readiness.version}`,
    `state=${readiness.state}`,
    `mode=${readiness.mode}`,
    `routing=${readiness.answerRouting.enabled ? "on" : "off"}`,
    `trace=${readiness.trace.enabled ? "on" : "off"}`,
    `issues=${readiness.issues.join(",") || "none"}`,
  ].join(" ");
}
