/** Browser-side opaque correlation for Dime Conversation Trace v1. */

export const DIME_CHAT_TRACE_VERSION = 1 as const;
export const DIME_CHAT_TRACE_SESSION_KEY = "dime_chat_session_v1";
export const DIME_CHAT_TRACE_HEADER = "X-Dime-Trace-Version";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let volatileSessionId: string | null = null;

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

export interface DimeChatClientTraceState {
  assistantId: string;
  request: DimeChatTraceRequest;
  serverOwned: boolean;
  serverTrace: DimeChatServerTrace | null;
}

interface PreviousClientTrace {
  request: DimeChatTraceRequest;
  serverTrace: DimeChatServerTrace | null;
}

/** UUIDs are identity-free and used only for replay/idempotency correlation. */
export function createDimeTraceId(
  cryptoApi:
    | Pick<Crypto, "randomUUID" | "getRandomValues">
    | undefined = globalThis.crypto
): string {
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  if (!cryptoApi?.getRandomValues) {
    throw new Error("Secure UUID generation is unavailable.");
  }
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes)
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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

export function createInitialDimeChatTrace(input: {
  threadId: number | null;
  clientSessionId: string | null;
}) {
  const clientSessionId =
    input.clientSessionId ?? getOrCreateDimeChatSessionId();
  const userId = createDimeTraceId();
  const assistantId = createDimeTraceId();
  const request = createDimeChatTraceRequest({
    threadId: input.threadId,
    clientSessionId,
    clientUserMessageId: userId,
    clientAssistantMessageId: assistantId,
  });
  return {
    userId,
    clientSessionId,
    state: { assistantId, request, serverOwned: false, serverTrace: null },
  };
}

export function createRetryDimeChatTrace(input: {
  threadId: number | null;
  clientSessionId: string | null;
  clientUserMessageId: string;
  activeTrace: PreviousClientTrace | null;
  settledTrace: PreviousClientTrace | null;
}) {
  const clientSessionId =
    input.clientSessionId ?? getOrCreateDimeChatSessionId();
  const assistantId = createDimeTraceId();
  const previous =
    input.activeTrace?.request.clientUserMessageId === input.clientUserMessageId
      ? input.activeTrace
      : input.settledTrace?.request.clientUserMessageId ===
          input.clientUserMessageId
        ? input.settledTrace
        : null;
  const request = previous?.serverTrace
    ? createDimeChatTraceRequest({
        threadId: previous.serverTrace.threadId,
        clientSessionId,
        clientTurnId: previous.request.clientTurnId,
        clientUserMessageId: previous.request.clientUserMessageId,
        clientAssistantMessageId: assistantId,
        retryOfGenerationId: previous.serverTrace.generationId,
      })
    : previous
      ? createDimeChatTraceRequest({
          ...previous.request,
          clientAssistantMessageId: previous.request.clientAssistantMessageId,
          idempotencyKey: previous.request.idempotencyKey,
        })
      : createDimeChatTraceRequest({
          threadId: input.threadId,
          clientSessionId,
          clientUserMessageId: input.clientUserMessageId,
          clientAssistantMessageId: assistantId,
        });
  return {
    clientSessionId,
    state: { assistantId, request, serverOwned: false, serverTrace: null },
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

function isActiveTrace(
  active: DimeChatClientTraceState | null,
  assistantId: string,
  idempotencyKey: string
): active is DimeChatClientTraceState {
  return (
    active?.assistantId === assistantId &&
    active.request.idempotencyKey === idempotencyKey
  );
}

export function bindDimeChatServerTrace(
  value: unknown,
  active: DimeChatClientTraceState | null,
  assistantId: string,
  idempotencyKey: string
): DimeChatServerTrace | null {
  const serverTrace = parseDimeChatServerTrace(value);
  if (!serverTrace || !isActiveTrace(active, assistantId, idempotencyKey)) {
    return null;
  }
  active.serverOwned = true;
  active.serverTrace = serverTrace;
  return serverTrace;
}

export function claimDimeChatTraceResponse(
  header: string | null,
  active: DimeChatClientTraceState | null,
  assistantId: string,
  idempotencyKey: string
): boolean {
  if (
    !isDimeChatTraceResponse(header) ||
    !isActiveTrace(active, assistantId, idempotencyKey)
  ) {
    return false;
  }
  active.serverOwned = true;
  return true;
}
