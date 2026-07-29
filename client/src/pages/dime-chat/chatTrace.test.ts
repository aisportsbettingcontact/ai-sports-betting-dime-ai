import { describe, expect, it } from "vitest";
import {
  DIME_CHAT_TRACE_HEADER,
  DIME_CHAT_TRACE_SESSION_KEY,
  bindDimeChatServerTrace,
  claimDimeChatTraceResponse,
  createDimeChatTraceRequest,
  createInitialDimeChatTrace,
  createRetryDimeChatTrace,
  createDimeTraceId,
  getOrCreateDimeChatSessionId,
  isDimeChatTraceResponse,
  isDimeTraceId,
  parseDimeChatServerTrace,
} from "./chatTrace";

const ids = {
  requestId: "018f4eb2-53c1-7bd2-8b6f-6b9a929426e7",
  chatSessionId: "018f4eb2-53c1-7bd2-8b6f-6b9a929426e8",
  turnId: "018f4eb2-53c1-7bd2-8b6f-6b9a929426e9",
  generationId: "018f4eb2-53c1-7bd2-8b6f-6b9a929426ea",
};

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const values = new Map<string, string>();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

describe("Dime Conversation Trace v1 client identity", () => {
  it("creates collision-resistant UUID-shaped correlation ids", () => {
    const first = createDimeTraceId();
    const second = createDimeTraceId();
    expect(isDimeTraceId(first)).toBe(true);
    expect(isDimeTraceId(second)).toBe(true);
    expect(second).not.toBe(first);
  });

  it("keeps one opaque session id in sessionStorage", () => {
    const storage = memoryStorage();
    const first = getOrCreateDimeChatSessionId(storage);
    const second = getOrCreateDimeChatSessionId(storage);
    expect(second).toBe(first);
    expect(storage.getItem(DIME_CHAT_TRACE_SESSION_KEY)).toBe(first);
  });

  it("survives storage denial with a stable in-memory session", () => {
    const denied = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(getOrCreateDimeChatSessionId(denied)).toBe(
      getOrCreateDimeChatSessionId(denied)
    );
  });

  it("builds the exact v1 request envelope without user identity", () => {
    const envelope = createDimeChatTraceRequest({
      threadId: 42,
      clientSessionId: ids.chatSessionId,
    });
    expect(envelope.version).toBe(1);
    expect(envelope.threadId).toBe(42);
    expect(envelope.clientSessionId).toBe(ids.chatSessionId);
    expect(isDimeTraceId(envelope.clientTurnId)).toBe(true);
    expect(isDimeTraceId(envelope.clientUserMessageId)).toBe(true);
    expect(isDimeTraceId(envelope.clientAssistantMessageId)).toBe(true);
    expect(isDimeTraceId(envelope.idempotencyKey)).toBe(true);
    expect(envelope).not.toHaveProperty("userId");
  });

  it("accepts only the exact Trace v1 response capability header", () => {
    expect(DIME_CHAT_TRACE_HEADER).toBe("X-Dime-Trace-Version");
    expect(isDimeChatTraceResponse("1")).toBe(true);
    expect(isDimeChatTraceResponse(" 1 ")).toBe(true);
    expect(isDimeChatTraceResponse(null)).toBe(false);
    expect(isDimeChatTraceResponse("2")).toBe(false);
  });
});

describe("Dime Conversation Trace v1 server metadata", () => {
  it("accepts valid canonical metadata", () => {
    expect(
      parseDimeChatServerTrace({
        version: 1,
        ...ids,
        threadId: 42,
        userMessageId: 101,
        assistantMessageId: 102,
      })
    ).toEqual({
      version: 1,
      ...ids,
      threadId: 42,
      userMessageId: 101,
      assistantMessageId: 102,
    });
  });

  it.each([
    null,
    {},
    { version: 2, ...ids, threadId: 42, userMessageId: 101 },
    { version: 1, ...ids, threadId: -1, userMessageId: 101 },
    {
      version: 1,
      ...ids,
      requestId: "not-a-uuid",
      threadId: 42,
      userMessageId: 101,
    },
  ])("rejects malformed metadata without partial state (%j)", value => {
    expect(parseDimeChatServerTrace(value)).toBeNull();
  });

  it("claims only matching server-owned responses", () => {
    const initial = createInitialDimeChatTrace({
      threadId: null,
      clientSessionId: ids.chatSessionId,
    });
    expect(
      claimDimeChatTraceResponse(
        "1",
        initial.state,
        initial.state.assistantId,
        initial.state.request.idempotencyKey
      )
    ).toBe(true);
    expect(initial.state.serverOwned).toBe(true);

    const metadata = {
      version: 1,
      ...ids,
      threadId: 42,
      userMessageId: 101,
    };
    expect(
      bindDimeChatServerTrace(
        metadata,
        initial.state,
        initial.state.assistantId,
        initial.state.request.idempotencyKey
      )
    ).toEqual(metadata);
    expect(initial.state.serverTrace).toEqual(metadata);
  });

  it("preserves the turn identity while creating a distinct retry generation", () => {
    const initial = createInitialDimeChatTrace({
      threadId: 42,
      clientSessionId: ids.chatSessionId,
    });
    initial.state.serverTrace = {
      version: 1,
      ...ids,
      threadId: 42,
      userMessageId: 101,
    };
    const retry = createRetryDimeChatTrace({
      threadId: 42,
      clientSessionId: ids.chatSessionId,
      clientUserMessageId: initial.userId,
      activeTrace: initial.state,
      settledTrace: null,
    });

    expect(retry.state.request.clientTurnId).toBe(
      initial.state.request.clientTurnId
    );
    expect(retry.state.request.clientUserMessageId).toBe(initial.userId);
    expect(retry.state.assistantId).not.toBe(initial.state.assistantId);
    expect(retry.state.request.idempotencyKey).not.toBe(
      initial.state.request.idempotencyKey
    );
    expect(retry.state.request.retryOfGenerationId).toBe(ids.generationId);
    expect(retry.state.serverOwned).toBe(false);
  });
});
