import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DIME_CHAT_TRACE_GENERATION_LEASE_MS,
  DIME_CHAT_TRACE_POLICY_VERSION,
  DIME_CHAT_TRACE_RETENTION_DAYS,
  dimeChatTraceMeta,
  hashDimeChatTraceText,
  isDimeChatTraceEnabled,
  parseDimeChatTraceEnvelope,
  validateDimeChatTraceRestrictedText,
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
    };
    expect(dimeChatTraceMeta(trace, 102)).toEqual({
      version: 1,
      requestId: trace.requestId,
      chatSessionId: trace.chatSessionId,
      threadId: 42,
      turnId: trace.turnId,
      userMessageId: 101,
      generationId: trace.generationId,
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
