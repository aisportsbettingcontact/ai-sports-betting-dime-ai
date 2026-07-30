import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DIME_CHAT_TRACE_GENERATION_LEASE_MS,
  DIME_CHAT_TRACE_POLICY_VERSION,
  DIME_CHAT_TRACE_RETENTION_DAYS,
  dimeChatTraceMeta,
  hashDimeChatTraceRequestFingerprint,
  hashDimeChatTraceText,
  isDimeChatTraceEnabled,
  parseDimeChatTraceEnvelope,
  type BeginDimeChatTraceInput,
  validateDimeChatTraceEventIds,
  validateDimeChatTraceRestrictedText,
  validateDimeChatTraceRoutingMetadata,
} from "./dimeChatTrace";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const schemaSource = fs.readFileSync(
  path.join(repositoryRoot, "drizzle", "schema.ts"),
  "utf8"
);
const migrationSource = fs.readFileSync(
  path.join(repositoryRoot, "drizzle", "0121_dime_conversation_trace_v1.sql"),
  "utf8"
);
const routeSource = fs.readFileSync(
  path.join(import.meta.dirname, "dime-chat.route.ts"),
  "utf8"
);
const deterministicMathHandlerSource = fs.readFileSync(
  path.join(import.meta.dirname, "_core", "dimeDeterministicMathHandler.ts"),
  "utf8"
);
const traceSource = fs.readFileSync(
  path.join(import.meta.dirname, "dimeChatTrace.ts"),
  "utf8"
);
const routerSource = fs.readFileSync(
  path.join(import.meta.dirname, "routers", "dimeChats.ts"),
  "utf8"
);

function validEnvelope() {
  return {
    version: 1,
    threadId: 42,
    clientSessionId: randomUUID(),
    clientTurnId: randomUUID(),
    clientUserMessageId: randomUUID(),
    clientAssistantMessageId: randomUUID(),
    idempotencyKey: randomUUID(),
  };
}

function validBeginInput(): BeginDimeChatTraceInput {
  const requestId = randomUUID();
  return {
    requestId,
    userId: 7,
    envelope: validEnvelope(),
    userPrompt: "What is the current Lakers moneyline?",
    history: [
      {
        role: "user",
        content: "What is the current Lakers moneyline?",
      },
    ],
    requestClass: "standard",
    responseBudget: 800,
    provider: {
      provider: "runpod",
      deploymentTier: "production",
      requestedModel: "dime-1.0",
      baseRevision: "base-a",
      adapterRevision: "adapter-a",
      productProfile: "dime-chat",
      profileVersion: "profile-a",
      promptSource: "server",
      maxTokens: 800,
    },
    identity: {
      observabilityRevision: "dime-trace-observability-v1",
      requestId,
      applicationVersion: "1.0.0",
      gitCommit: "03f75a9348d588714ba7da68e28cfe8d186fed7c",
      environment: "production",
      modelProvider: "runpod",
      baseModel: "dime-1.0",
      modelRevision: "base-a",
      adapterRevision: "adapter-a",
      promptRevision: "profile-a",
      route: "live_data",
      routePolicyRevision: "a".repeat(64),
      controlPlaneRevision: "dime-composite-engineering-control-v1",
      traceSchemaRevision: "trace-v1-phase1-2026-07-29",
    },
  };
}

function requestFingerprint(input: BeginDimeChatTraceInput): string {
  return hashDimeChatTraceRequestFingerprint(
    input,
    hashDimeChatTraceText(input.userPrompt),
    hashDimeChatTraceText(JSON.stringify(input.history))
  );
}

describe("Dime Conversation Trace v1 request contract", () => {
  it("is fail-closed and requires the exact enable value", () => {
    expect(isDimeChatTraceEnabled({})).toBe(false);
    expect(isDimeChatTraceEnabled({ DIME_CHAT_TRACE_V1_ENABLED: "1" })).toBe(
      false
    );
    expect(
      isDimeChatTraceEnabled({
        DIME_CHAT_TRACE_V1_ENABLED: "true",
      })
    ).toBe(true);
  });

  it("accepts only the strict v1 identity-free envelope", () => {
    const envelope = validEnvelope();
    expect(parseDimeChatTraceEnvelope(envelope)).toEqual({
      kind: "valid",
      value: envelope,
    });
    expect(parseDimeChatTraceEnvelope({ ...envelope, userId: 7 }).kind).toBe(
      "invalid"
    );
    expect(
      parseDimeChatTraceEnvelope({
        ...envelope,
        idempotencyKey: "reused-human-label",
      }).kind
    ).toBe("invalid");
  });

  it("distinguishes a rolling old client from malformed v1 metadata", () => {
    expect(parseDimeChatTraceEnvelope(undefined)).toEqual({
      kind: "absent",
    });
    expect(parseDimeChatTraceEnvelope({ version: 1 }).kind).toBe("invalid");
  });

  it("hashes exact text deterministically", () => {
    expect(hashDimeChatTraceText("Dime")).toBe(
      "4ff47d9dad302b5c2884031f4f5f6c02a8aac456302afdedca413d24ca6f780e"
    );
    expect(hashDimeChatTraceText("Dime ")).not.toBe(
      hashDimeChatTraceText("Dime")
    );
  });

  it("replays the same client request after a lost response or process restart", () => {
    const accepted = validBeginInput();
    const retry = structuredClone(accepted);
    retry.requestId = randomUUID();
    retry.identity = {
      ...retry.identity,
      requestId: retry.requestId,
      applicationVersion: "1.0.1",
      gitCommit: "a".repeat(40),
      modelRevision: "base-b",
      routePolicyRevision: "b".repeat(64),
    };
    retry.requestClass = "deep";
    retry.responseBudget = 1_200;
    retry.provider = {
      ...retry.provider,
      requestedModel: "dime-1.1",
      baseRevision: "base-b",
      maxTokens: 1_200,
    };

    expect(requestFingerprint(retry)).toBe(requestFingerprint(accepted));
  });

  it("rejects reuse of an idempotency key for changed prompt input", () => {
    const accepted = validBeginInput();
    const changed = structuredClone(accepted);
    changed.userPrompt = "What is the current Celtics moneyline?";
    changed.history = [{ role: "user", content: changed.userPrompt }];

    expect(requestFingerprint(changed)).not.toBe(requestFingerprint(accepted));
  });

  it("keeps concurrent duplicate attempts on one canonical fingerprint", async () => {
    const accepted = validBeginInput();
    const fingerprints = await Promise.all(
      Array.from({ length: 8 }, async () =>
        requestFingerprint(structuredClone(accepted))
      )
    );

    expect(new Set(fingerprints)).toEqual(
      new Set([requestFingerprint(accepted)])
    );
    expect(schemaSource).toContain(
      '"idx_dime_chat_generations_user_idempotency"'
    );
    expect(schemaSource).toContain(").on(t.userId, t.idempotencyKey)");
    expect(traceSource).toContain('code === "ER_DUP_ENTRY"');
    expect(traceSource).toContain("const raced = resolveExistingAttempt(");
  });

  it("separates the same idempotency envelope across authenticated users", () => {
    const firstUser = validBeginInput();
    const secondUser = structuredClone(firstUser);
    secondUser.userId = firstUser.userId + 1;

    expect(requestFingerprint(secondUser)).not.toBe(
      requestFingerprint(firstUser)
    );
  });

  it("emits server-owned trace metadata only", () => {
    const trace = {
      version: 1 as const,
      requestId: randomUUID(),
      chatSessionId: randomUUID(),
      threadId: 42,
      turnId: randomUUID(),
      userMessageId: 101,
      generationId: randomUUID(),
      clientAssistantMessageId: randomUUID(),
      attempt: 1,
      identity: {
        observabilityRevision: "dime-trace-observability-v1" as const,
        requestId: randomUUID(),
        applicationVersion: "1.0.0",
        gitCommit: "47e338fb",
        environment: "test",
        modelProvider: "frozen",
        baseModel: "no-provider",
        modelRevision: "no-provider",
        adapterRevision: null,
        promptRevision: "1.0.0",
        route: "platform" as const,
        routePolicyRevision: "a".repeat(64),
        controlPlaneRevision: "dime-composite-engineering-control-v1",
        traceSchemaRevision: "trace-v1-phase1-2026-07-29" as const,
      },
    };
    expect(dimeChatTraceMeta(trace, 102)).toEqual({
      version: 1,
      observabilityRevision: "dime-trace-observability-v1",
      traceSchemaRevision: "trace-v1-phase1-2026-07-29",
      requestId: trace.requestId,
      chatSessionId: trace.chatSessionId,
      threadId: 42,
      turnId: trace.turnId,
      userMessageId: 101,
      generationId: trace.generationId,
      productRoute: "platform",
      assistantMessageId: 102,
    });
  });

  it("pins the restricted trace retention and policy version", () => {
    expect(DIME_CHAT_TRACE_RETENTION_DAYS).toBe(90);
    expect(DIME_CHAT_TRACE_POLICY_VERSION).toBe("trace-v1-2026-07-28");
    expect(DIME_CHAT_TRACE_GENERATION_LEASE_MS).toBe(30 * 60 * 1_000);
  });

  it("enforces MySQL TEXT limits by UTF-8 bytes, not JavaScript characters", () => {
    const exact = "🎯".repeat(15_000);
    expect(validateDimeChatTraceRestrictedText(exact)).toBe(exact);
    expect(() => validateDimeChatTraceRestrictedText(`${exact}🎯`)).toThrow(
      "exceeds the Trace v1 storage contract"
    );
  });

  it("accepts only unique positive bounded context event IDs", () => {
    expect(validateDimeChatTraceEventIds(undefined)).toEqual([]);
    expect(validateDimeChatTraceEventIds([7, 11])).toEqual([7, 11]);
    expect(() => validateDimeChatTraceEventIds([7, 7])).toThrow(
      "bounded identity contract"
    );
    expect(() => validateDimeChatTraceEventIds([0])).toThrow(
      "bounded identity contract"
    );
    expect(() =>
      validateDimeChatTraceEventIds(
        Array.from({ length: 13 }, (_, index) => index + 1)
      )
    ).toThrow("bounded identity contract");
  });

  it("accepts only canonical bounded routing and context metadata", () => {
    const metadata = {
      answerMode: "matchup" as const,
      productRoute: "matchup" as const,
      routingVersion: "runtime-answer-routing-v1",
      dateSource: "explicit" as const,
      requestedDate: "2026-07-28",
      league: "MLB" as const,
      eventResolution: "exact" as const,
      groundingStatus: "full_event" as const,
      retrievalCandidateCount: 64,
      retrievalLatencyMs: 120_000,
      confidence: 1,
      completenessStatus: "passed" as const,
    };
    expect(validateDimeChatTraceRoutingMetadata(metadata)).toEqual(metadata);
    expect(validateDimeChatTraceRoutingMetadata({})).toEqual({});
  });

  it("rejects non-canonical routing labels and raw query-shaped metadata", () => {
    for (const metadata of [
      { answerMode: "game" },
      { productRoute: "current_games" },
      { routingVersion: "" },
      { routingVersion: "runtime answer routing v1" },
      { routingVersion: `v${"1".repeat(64)}` },
      { dateSource: "today" },
      { requestedDate: "2026-02-29" },
      { requestedDate: "July 28, 2026" },
      { league: "BASEBALL" },
      { eventResolution: "close_enough" },
      { groundingStatus: "maybe" },
      { completenessStatus: "mostly_complete" },
      { prompt: "Who wins Yankees versus Red Sox?" },
      { teamAliases: ["Yankees", "Red Sox"] },
    ]) {
      expect(() => validateDimeChatTraceRoutingMetadata(metadata)).toThrow(
        "bounded contract"
      );
    }
  });

  it("rejects routing counts, latency, and confidence outside their bounds", () => {
    for (const metadata of [
      { retrievalCandidateCount: -1 },
      { retrievalCandidateCount: 1.5 },
      { retrievalCandidateCount: 65 },
      { retrievalLatencyMs: -1 },
      { retrievalLatencyMs: 1.5 },
      { retrievalLatencyMs: 120_001 },
      { confidence: -0.01 },
      { confidence: 1.01 },
      { confidence: Number.NaN },
      { confidence: Number.POSITIVE_INFINITY },
    ]) {
      expect(() => validateDimeChatTraceRoutingMetadata(metadata)).toThrow(
        "bounded contract"
      );
    }
  });
});

describe("Dime Conversation Trace v1 persistence contract", () => {
  it("defines sessions, turns, generations, events, and message links", () => {
    for (const table of [
      "dime_chat_sessions",
      "dime_chat_turns",
      "dime_chat_generations",
      "dime_chat_trace_events",
    ]) {
      expect(schemaSource).toContain(`"${table}"`);
      expect(migrationSource).toContain(`\`${table}\``);
    }
    for (const column of [
      'sessionId: varchar("sessionId"',
      'turnId: varchar("turnId"',
      'clientMessageId: varchar("clientMessageId"',
      'generationId: varchar("generationId"',
      'contentSha256: varchar("contentSha256"',
      'requestFingerprintSha256: varchar("requestFingerprintSha256"',
      'historySnapshot: mediumtext("historySnapshot")',
      'leaseExpiresAt: timestamp("leaseExpiresAt")',
    ]) {
      expect(schemaSource).toContain(column);
    }
  });

  it("preflights the unique sequence invariant before dropping the old index", () => {
    const uniqueIndex = migrationSource.indexOf(
      "ADD CONSTRAINT `uq_dime_chat_messages_thread_seq`"
    );
    const oldIndexDrop = migrationSource.indexOf(
      "DROP INDEX `idx_dime_chat_messages_thread_seq`"
    );
    expect(uniqueIndex).toBeGreaterThanOrEqual(0);
    expect(oldIndexDrop).toBeGreaterThan(uniqueIndex);
  });

  it("persists before provider execution and finalizes before serving output", () => {
    expect(routeSource).toContain("await beginDimeChatTrace({");
    expect(routeSource.indexOf("await beginDimeChatTrace({")).toBeLessThan(
      routeSource.indexOf("await handleDime1ChatRequest({")
    );
    expect(routeSource).toContain("await finalizeDimeChatTrace(activeTrace");
    expect(routeSource.indexOf("await finalizeDimeChatTrace(")).toBeLessThan(
      routeSource.lastIndexOf('send({ type: "delta", text: output })')
    );
  });

  it("serves deterministic math before any provider configuration or execution", () => {
    const deterministicIdx = routeSource.indexOf(
      "await handleDimeDeterministicMathResponse({"
    );
    expect(deterministicIdx).toBeGreaterThan(-1);
    expect(deterministicIdx).toBeLessThan(
      routeSource.indexOf(
        'DIME_CHAT_LLM_PROVIDER === "anthropic" && !hasAnthropicCredentials()'
      )
    );
    expect(deterministicIdx).toBeLessThan(
      routeSource.indexOf("await handleDime1ChatRequest({")
    );
    expect(deterministicIdx).toBeLessThan(
      routeSource.indexOf("createAnthropicClient()")
    );
    expect(deterministicMathHandlerSource).toContain("providerCallMade: false");
  });

  it("persists prompt knowledge identity and selected event IDs in Trace events", () => {
    expect(traceSource).toContain(
      "platformKnowledgeVersion: input.provider.platformKnowledgeVersion"
    );
    expect(traceSource).toContain(
      "platformKnowledgeSha256: input.provider.platformKnowledgeSha256"
    );
    expect(traceSource).toContain(
      "const eventIds = validateDimeChatTraceEventIds(input.eventIds)"
    );
    expect(traceSource).toContain("eventIds,");
    expect(routeSource).toContain("eventIds: contextEventIds");
  });

  it("persists bounded answer-routing metadata in context and generation events", () => {
    expect(traceSource.match(/\.\.\.routingMetadata/g)).toHaveLength(2);
    for (const field of [
      "answerMode",
      "routingVersion",
      "dateSource",
      "requestedDate",
      "league",
      "eventResolution",
      "groundingStatus",
      "retrievalCandidateCount",
      "retrievalLatencyMs",
      "confidence",
      "completenessStatus",
    ]) {
      expect(traceSource).toContain(`${field}: input.${field}`);
    }
    expect(traceSource).not.toContain("teamAliases: input.teamAliases");
    expect(traceSource).not.toContain("prompt: input.prompt");
  });

  it("adds Phase 1 observability through backward-compatible event metadata", () => {
    expect(traceSource).toContain("identity: input.identity");
    expect(traceSource).toContain("observability,");
    expect(traceSource).toContain("phase1: {");
    expect(traceSource).toContain(
      "refuses to finalize without explicit context/tool observability"
    );
    expect(schemaSource).toContain(
      "/** Sanitized JSON only; never credentials, cookies, or raw prompt text. */"
    );
    expect(migrationSource).not.toContain("phase1");
  });

  it("marks replay metadata as trace-owned instead of claiming the current prompt identity", () => {
    expect(routeSource).toContain('evidenceIdentity: "trace_lookup"');
  });

  it("recovers expired workers and returns canonical trace errors", () => {
    expect(routeSource).toContain("history: messages");
    expect(routeSource).toContain("sendDimeChatTraceJsonError(");
    expect(migrationSource).toContain("`leaseExpiresAt` timestamp NOT NULL");
    expect(migrationSource).toContain("`historySnapshot` mediumtext");
  });

  it("keeps restricted raw output out of the user-facing history router", () => {
    expect(routerSource).not.toContain("rawOutput");
    expect(routerSource).not.toContain("contextSnapshot");
    expect(routerSource).toContain("role: dimeChatMessages.role");
    expect(routerSource).toContain("content: dimeChatMessages.content");
  });

  it("serializes legacy compatibility writes with a row lock", () => {
    expect(routerSource).toContain("FOR UPDATE");
    expect(routerSource).toContain("return db.transaction(");
  });
});
