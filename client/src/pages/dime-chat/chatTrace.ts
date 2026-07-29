/** Browser-side opaque correlation for Dime Conversation Trace v1. */

export const DIME_CHAT_TRACE_VERSION = 1 as const;
export const DIME_CHAT_TRACE_SESSION_KEY = "dime_chat_session_v1";
export const DIME_CHAT_TRACE_HEADER = "X-Dime-Trace-Version";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let volatileSessionId: string | null = null;
let fallbackCounter = 0;

export interface DimeChatTraceRequest {
  version: typeof DIME_CHAT_TRACE_VERSION;
  threadId: number | null;
  clientSessionId: string;
  clientTurnId: string;
  clientUserMessageId: string;
  clientAssistantMessageId: string;
  idempotencyKey: string;
  retryOfGenerationId?: string;
}

export interface DimeChatServerTrace {
  version: typeof DIME_CHAT_TRACE_VERSION;
  requestId: string;
  chatSessionId: string;
  threadId: number;
  turnId: string;
  userMessageId: number;
  generationId: string;
  assistantMessageId?: number;
}

function formatUuid(bytes: Uint8Array): string {
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, value =>
    value.toString(16).padStart(2, "0")
  ).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

/** UUIDs are identity-free and used only for replay/idempotency correlation. */
export function createDimeTraceId(
  cryptoApi:
    | Pick<Crypto, "randomUUID" | "getRandomValues">
    | undefined = globalThis.crypto
): string {
  if (typeof cryptoApi?.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  if (typeof cryptoApi?.getRandomValues === "function") {
    return formatUuid(cryptoApi.getRandomValues(new Uint8Array(16)));
  }

  // Last-resort compatibility path for unusually restricted browsers. This
  // carries no user identity and combines time, a monotonic counter, and
  // process-local entropy before applying the UUID v4 shape.
  fallbackCounter += 1;
  const seed = `${Date.now()}-${fallbackCounter}-${Math.random()}`;
  const bytes = new Uint8Array(16);
  for (let index = 0; index < seed.length; index += 1) {
    bytes[index % 16] =
      (bytes[index % 16] * 31 + seed.charCodeAt(index)) & 0xff;
  }
  return formatUuid(bytes);
}

export function isDimeTraceId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function getOrCreateDimeChatSessionId(
  providedStorage?: Pick<Storage, "getItem" | "setItem">
): string {
  let storage = providedStorage;
  if (!storage && typeof window !== "undefined") {
    try {
      storage = window.sessionStorage;
    } catch {
      // Accessing the storage property itself may throw in privacy mode.
    }
  }
  try {
    const stored = storage?.getItem(DIME_CHAT_TRACE_SESSION_KEY);
    if (isDimeTraceId(stored)) return stored;
  } catch {
    // Privacy-mode storage denial falls through to the volatile session.
  }

  if (!volatileSessionId) volatileSessionId = createDimeTraceId();
  try {
    storage?.setItem(DIME_CHAT_TRACE_SESSION_KEY, volatileSessionId);
  } catch {
    // The in-memory value remains stable for this loaded page.
  }
  return volatileSessionId;
}

export function isDimeChatTraceResponse(value: string | null): boolean {
  return value?.trim() === String(DIME_CHAT_TRACE_VERSION);
}

export function createDimeChatTraceRequest(input: {
  threadId: number | null;
  clientSessionId: string;
  clientTurnId?: string;
  clientUserMessageId?: string;
  clientAssistantMessageId?: string;
  idempotencyKey?: string;
  retryOfGenerationId?: string;
}): DimeChatTraceRequest {
  return {
    version: DIME_CHAT_TRACE_VERSION,
    threadId: input.threadId,
    clientSessionId: input.clientSessionId,
    clientTurnId: input.clientTurnId ?? createDimeTraceId(),
    clientUserMessageId: input.clientUserMessageId ?? createDimeTraceId(),
    clientAssistantMessageId:
      input.clientAssistantMessageId ?? createDimeTraceId(),
    idempotencyKey: input.idempotencyKey ?? createDimeTraceId(),
    ...(input.retryOfGenerationId
      ? { retryOfGenerationId: input.retryOfGenerationId }
      : {}),
  };
}

function positiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

/** Fail-closed parser: malformed server metadata never controls chat state. */
export function parseDimeChatServerTrace(
  value: unknown
): DimeChatServerTrace | null {
  if (!value || typeof value !== "object") return null;
  const trace = value as Record<string, unknown>;
  if (
    trace.version !== DIME_CHAT_TRACE_VERSION ||
    !isDimeTraceId(trace.requestId) ||
    !isDimeTraceId(trace.chatSessionId) ||
    !positiveInteger(trace.threadId) ||
    !isDimeTraceId(trace.turnId) ||
    !positiveInteger(trace.userMessageId) ||
    !isDimeTraceId(trace.generationId) ||
    (trace.assistantMessageId !== undefined &&
      !positiveInteger(trace.assistantMessageId))
  ) {
    return null;
  }
  return {
    version: DIME_CHAT_TRACE_VERSION,
    requestId: trace.requestId,
    chatSessionId: trace.chatSessionId,
    threadId: trace.threadId,
    turnId: trace.turnId,
    userMessageId: trace.userMessageId,
    generationId: trace.generationId,
    ...(trace.assistantMessageId
      ? { assistantMessageId: trace.assistantMessageId }
      : {}),
  };
}
