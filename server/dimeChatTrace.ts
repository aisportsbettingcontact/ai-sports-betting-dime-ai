/**
 * Dime Conversation Trace v1
 * --------------------------------------------------------------------------
 * Railway is the authoritative store for every accepted prompt and every
 * generation attempt. The browser supplies only opaque idempotency UUIDs;
 * authenticated identity, ownership, sequence allocation, model metadata,
 * context, raw output, served output, and terminal status are server-owned.
 *
 * Rollout is fail-closed behind DIME_CHAT_TRACE_V1_ENABLED=true:
 * - flag off or no v1 envelope: the compatibility history path remains active;
 * - flag on + valid v1 envelope: persistence must succeed before inference;
 * - any canonical persistence failure prevents a provider call or withholds
 *   an unrecorded provider response.
 */

import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import type { Response } from "express";
import { z } from "zod";
import {
  dimeChatGenerations,
  dimeChatMessages,
  dimeChatSessions,
  dimeChatThreads,
  dimeChatTraceEvents,
  dimeChatTurns,
} from "../drizzle/schema";
import { getDb } from "./db";
import type {
  DimeChatMessage,
  DimeChatRequestClass,
} from "./_core/dimeChatModel";
import {
  assessDimeTraceCompleteness,
  estimateDimeTraceCost,
  parseDimeTraceIdentity,
  validateDimeContextMetrics,
  validateDimeEvidenceTimestamps,
  validateDimeStageLatency,
  validateDimeTraceMetadataSafety,
  validateDimeToolCallTrace,
  type DimeTraceContextObservability,
  type DimeTraceIdentity,
} from "./_core/dimeTraceObservability";
import {
  completeDimeIngestionLifecycleForResponse,
  validateDimeIngestionLifecycle,
  validateDimeProviderObservation,
} from "./_core/dimeEvidenceProvenance";

const acceptedAttemptEvent = alias(
  dimeChatTraceEvents,
  "accepted_attempt_event"
);

export const DIME_CHAT_TRACE_VERSION = 1 as const;
export const DIME_CHAT_TRACE_POLICY_VERSION = "trace-v1-2026-07-28";
export const DIME_CHAT_TRACE_RETENTION_DAYS = 90;
export const DIME_CHAT_TRACE_HEADER = "X-Dime-Trace-Version";
export const DIME_CHAT_TRACE_GENERATION_LEASE_MS = 30 * 60 * 1_000;

const MAX_RESTRICTED_TEXT_BYTES = 60_000;
const MAX_HISTORY_SNAPSHOT_BYTES = 1_000_000;
const TITLE_MAX = 80;
const MAX_ROUTING_VERSION_LENGTH = 64;
const MAX_RETRIEVAL_CANDIDATE_COUNT = 64;
const MAX_RETRIEVAL_LATENCY_MS = 120_000;

const traceRoutingMetadataSchema = z
  .object({
    answerMode: z
      .enum(["platform", "matchup", "slate", "educational"])
      .optional(),
    productRoute: z
      .enum([
        "platform",
        "matchup",
        "full_slate",
        "educational",
        "bet_explanation",
        "historical",
        "account",
        "live_data",
        "general_sports",
      ])
      .optional(),
    routingVersion: z
      .string()
      .min(1)
      .max(MAX_ROUTING_VERSION_LENGTH)
      .regex(/^[a-z0-9][a-z0-9._-]*$/i)
      .optional(),
    dateSource: z
      .enum(["explicit", "relative", "none", "invalid", "ambiguous"])
      .optional(),
    requestedDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine(value => {
        const [year, month, day] = value.split("-").map(Number);
        const parsed = new Date(Date.UTC(year, month - 1, day));
        return (
          parsed.getUTCFullYear() === year &&
          parsed.getUTCMonth() === month - 1 &&
          parsed.getUTCDate() === day
        );
      })
      .optional(),
    league: z.enum(["MLB", "NBA", "NHL", "NCAAM", "NFL", "NCAAF"]).optional(),
    eventResolution: z
      .enum(["exact", "nearby", "ambiguous", "missing", "not_applicable"])
      .optional(),
    groundingStatus: z
      .enum(["full_event", "identity_only", "catalog_only", "none"])
      .optional(),
    retrievalCandidateCount: z
      .number()
      .int()
      .min(0)
      .max(MAX_RETRIEVAL_CANDIDATE_COUNT)
      .optional(),
    retrievalLatencyMs: z
      .number()
      .int()
      .min(0)
      .max(MAX_RETRIEVAL_LATENCY_MS)
      .optional(),
    confidence: z.number().min(0).max(1).optional(),
    completenessStatus: z
      .enum(["passed", "failed", "not_applicable", "disabled"])
      .optional(),
  })
  .strict();

const traceEnvelopeSchema = z
  .object({
    version: z.literal(DIME_CHAT_TRACE_VERSION),
    threadId: z.number().int().positive().nullable(),
    clientSessionId: z.string().uuid(),
    clientTurnId: z.string().uuid(),
    clientUserMessageId: z.string().uuid(),
    clientAssistantMessageId: z.string().uuid(),
    idempotencyKey: z.string().uuid(),
    retryOfGenerationId: z.string().uuid().optional(),
  })
  .strict();

export type DimeChatTraceEnvelope = z.infer<typeof traceEnvelopeSchema>;

export type DimeChatTraceEnvelopeResult =
  | { kind: "absent" }
  | { kind: "invalid"; issues: string[] }
  | { kind: "valid"; value: DimeChatTraceEnvelope };

export interface DimeChatTraceProviderMetadata {
  provider: string;
  deploymentTier: string;
  requestedModel: string;
  endpointSource?: string;
  baseRevision?: string;
  adapterRevision?: string;
  productProfile: string;
  profileVersion: string;
  promptSource: string;
  systemPrompt?: string;
  blueprintHash?: string;
  platformKnowledgeVersion?: string;
  platformKnowledgeSha256?: string;
  maxTokens: number;
  temperature?: number;
}

export interface ActiveDimeChatTrace {
  version: typeof DIME_CHAT_TRACE_VERSION;
  requestId: string;
  chatSessionId: string;
  threadId: number;
  turnId: string;
  userMessageId: number;
  generationId: string;
  clientAssistantMessageId: string;
  attempt: number;
  identity: DimeTraceIdentity;
  contextObservability?: DimeTraceContextObservability;
}

export type DimeChatTraceBeginResult =
  | { kind: "started"; trace: ActiveDimeChatTrace }
  | {
      kind: "replay";
      trace: ActiveDimeChatTrace;
      servedOutput: string;
      stopReason: string;
      dataFreshness: "live" | "delayed" | "none";
      status: "completed" | "blocked";
      assistantMessageId: number | null;
    }
  | { kind: "in_progress"; trace: ActiveDimeChatTrace }
  | { kind: "conflict"; reason: string }
  | { kind: "terminal_error"; trace: ActiveDimeChatTrace };

export interface BeginDimeChatTraceInput {
  requestId: string;
  userId: number;
  envelope: DimeChatTraceEnvelope;
  userPrompt: string;
  history: DimeChatMessage[];
  requestClass: DimeChatRequestClass;
  responseBudget: number;
  provider: DimeChatTraceProviderMetadata;
  identity: DimeTraceIdentity;
}

export type DimeChatTraceRoutingMetadata = z.infer<
  typeof traceRoutingMetadataSchema
>;

export interface DimeChatTraceContextInput
  extends DimeChatTraceRoutingMetadata {
  freshness: "live" | "delayed" | "none";
  rowCount: number;
  eventIds?: number[];
  context?: string;
  lookupErrorClass?: string;
  observability: DimeTraceContextObservability;
}

export interface FinalizeDimeChatTraceInput
  extends DimeChatTraceRoutingMetadata {
  rawOutput: string;
  servedOutput: string;
  status: "completed" | "blocked";
  finishReason?: string | null;
  actualModel?: string;
  validationErrors?: string[];
  certaintyViolation?: boolean;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    cachedInputTokens?: number;
  };
  modelTimeToFirstTokenMs?: number;
  modelCompletionMs?: number;
  validationMs?: number;
  zeroCostRuntime?: boolean;
  latencyMs: number;
}

export class DimeChatTracePersistenceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DimeChatTracePersistenceError";
  }
}

export function validateDimeChatTraceEventIds(
  value: number[] | undefined
): number[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > 12 ||
    value.some(eventId => !Number.isSafeInteger(eventId) || eventId <= 0) ||
    new Set(value).size !== value.length
  ) {
    throw new DimeChatTracePersistenceError(
      "Trace v1 context event IDs failed their bounded identity contract."
    );
  }
  return [...value];
}

export function validateDimeChatTraceRoutingMetadata(
  value: unknown
): DimeChatTraceRoutingMetadata {
  const parsed = traceRoutingMetadataSchema.safeParse(value);
  if (!parsed.success) {
    throw new DimeChatTracePersistenceError(
      "Trace v1 routing metadata failed its bounded contract."
    );
  }
  return parsed.data;
}

function routingMetadataFromInput(
  input: DimeChatTraceRoutingMetadata
): DimeChatTraceRoutingMetadata {
  return validateDimeChatTraceRoutingMetadata({
    answerMode: input.answerMode,
    productRoute: input.productRoute,
    routingVersion: input.routingVersion,
    dateSource: input.dateSource,
    requestedDate: input.requestedDate,
    league: input.league,
    eventResolution: input.eventResolution,
    groundingStatus: input.groundingStatus,
    retrievalCandidateCount: input.retrievalCandidateCount,
    retrievalLatencyMs: input.retrievalLatencyMs,
    confidence: input.confidence,
    completenessStatus: input.completenessStatus,
  });
}

class DimeChatTraceBusyError extends Error {
  constructor() {
    super("Another generation is already active for this chat.");
    this.name = "DimeChatTraceBusyError";
  }
}

export function isDimeChatTraceEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env.DIME_CHAT_TRACE_V1_ENABLED?.trim() === "true";
}

export function parseDimeChatTraceEnvelope(
  value: unknown
): DimeChatTraceEnvelopeResult {
  if (value === undefined || value === null) return { kind: "absent" };
  const parsed = traceEnvelopeSchema.safeParse(value);
  if (!parsed.success) {
    return {
      kind: "invalid",
      issues: parsed.error.issues.map(issue => issue.path.join(".") || "trace"),
    };
  }
  return { kind: "valid", value: parsed.data };
}

export function hashDimeChatTraceText(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function dimeChatTraceMeta(
  trace: ActiveDimeChatTrace,
  assistantMessageId?: number | null
) {
  return {
    version: DIME_CHAT_TRACE_VERSION,
    observabilityRevision: trace.identity.observabilityRevision,
    traceSchemaRevision: trace.identity.traceSchemaRevision,
    requestId: trace.requestId,
    chatSessionId: trace.chatSessionId,
    threadId: trace.threadId,
    turnId: trace.turnId,
    userMessageId: trace.userMessageId,
    generationId: trace.generationId,
    productRoute: trace.identity.route,
    ...(assistantMessageId ? { assistantMessageId } : {}),
  };
}

function deriveTraceThreadTitle(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= TITLE_MAX) return collapsed;
  return `${collapsed.slice(0, TITLE_MAX - 1).trimEnd()}…`;
}

export function validateDimeChatTraceRestrictedText(
  value: string | undefined,
  field = "restrictedText"
) {
  if (value === undefined) return undefined;
  if (Buffer.byteLength(value, "utf8") > MAX_RESTRICTED_TEXT_BYTES) {
    throw new DimeChatTracePersistenceError(
      `${field} exceeds the Trace v1 storage contract.`
    );
  }
  return value;
}

function historySnapshot(history: DimeChatMessage[]): string {
  const serialized = JSON.stringify(history);
  if (Buffer.byteLength(serialized, "utf8") > MAX_HISTORY_SNAPSHOT_BYTES) {
    throw new DimeChatTracePersistenceError(
      "historySnapshot exceeds the Trace v1 storage contract."
    );
  }
  return serialized;
}

function safeMetadata(value: Record<string, unknown>): string {
  const serialized = JSON.stringify(validateDimeTraceMetadataSafety(value));
  if (serialized.length > 8_000) {
    throw new DimeChatTracePersistenceError(
      "Trace event metadata exceeds the storage contract."
    );
  }
  return serialized;
}

function retentionDeadline(now: Date): Date {
  return new Date(
    now.getTime() + DIME_CHAT_TRACE_RETENTION_DAYS * 24 * 60 * 60 * 1_000
  );
}

function generationLeaseDeadline(now: Date): Date {
  return new Date(now.getTime() + DIME_CHAT_TRACE_GENERATION_LEASE_MS);
}

/**
 * Hash only authenticated user scope and client-owned request semantics.
 *
 * Server-owned execution metadata (requestId, release identity, routing,
 * provider configuration, and response budgets) can legitimately change
 * between an accepted request and a transport retry. Including any of it
 * would turn a lost-response replay into a false idempotency conflict.
 */
export function hashDimeChatTraceRequestFingerprint(
  input: BeginDimeChatTraceInput,
  inputSha256: string,
  historySha256: string
): string {
  return hashDimeChatTraceText(
    JSON.stringify({
      version: DIME_CHAT_TRACE_VERSION,
      userId: input.userId,
      envelope: input.envelope,
      inputSha256,
      historySha256,
    })
  );
}

export function sendDimeChatTraceJsonError(
  res: Response,
  status: number,
  error: string,
  trace?: ActiveDimeChatTrace
): void {
  if (trace) res.setHeader(DIME_CHAT_TRACE_HEADER, "1");
  res.status(status).json({
    error,
    ...(trace ? { trace: dimeChatTraceMeta(trace) } : {}),
  });
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ER_DUP_ENTRY"
  );
}

async function requireTraceDb() {
  const db = await getDb();
  if (!db) {
    throw new DimeChatTracePersistenceError(
      "Trace v1 database is unavailable."
    );
  }
  return db;
}

async function findExistingAttempt(
  db: Awaited<ReturnType<typeof requireTraceDb>>,
  userId: number,
  idempotencyKey: string
) {
  const rows = await db
    .select({
      generationId: dimeChatGenerations.id,
      generationRequestId: dimeChatGenerations.requestId,
      clientAssistantMessageId: dimeChatGenerations.clientAssistantMessageId,
      generationInputSha256: dimeChatGenerations.inputSha256,
      generationHistorySha256: dimeChatGenerations.historySha256,
      requestFingerprintSha256: dimeChatGenerations.requestFingerprintSha256,
      requestedThreadId: dimeChatGenerations.requestedThreadId,
      generationStatus: dimeChatGenerations.status,
      servedOutput: dimeChatGenerations.servedOutput,
      finishReason: dimeChatGenerations.finishReason,
      contextFreshness: dimeChatGenerations.contextFreshness,
      attempt: dimeChatGenerations.attempt,
      turnId: dimeChatTurns.id,
      sessionId: dimeChatTurns.sessionId,
      threadId: dimeChatTurns.threadId,
      userMessageId: dimeChatTurns.userMessageId,
      assistantMessageId: dimeChatTurns.assistantMessageId,
      clientTurnId: dimeChatTurns.clientTurnId,
      clientSessionId: dimeChatSessions.clientSessionId,
      clientUserMessageId: dimeChatMessages.clientMessageId,
      acceptedIdentityMetadata: acceptedAttemptEvent.metadata,
      retryOfGenerationId: sql<
        string | null
      >`JSON_UNQUOTE(JSON_EXTRACT(${acceptedAttemptEvent.metadata}, '$.retryOfGenerationId'))`,
    })
    .from(dimeChatGenerations)
    .innerJoin(dimeChatTurns, eq(dimeChatTurns.id, dimeChatGenerations.turnId))
    .innerJoin(
      dimeChatSessions,
      eq(dimeChatSessions.id, dimeChatTurns.sessionId)
    )
    .innerJoin(
      dimeChatMessages,
      eq(dimeChatMessages.id, dimeChatTurns.userMessageId)
    )
    .leftJoin(
      acceptedAttemptEvent,
      and(
        eq(acceptedAttemptEvent.generationId, dimeChatGenerations.id),
        inArray(acceptedAttemptEvent.eventType, [
          "prompt_persisted",
          "generation_retry_started",
        ])
      )
    )
    .where(
      and(
        eq(dimeChatGenerations.userId, userId),
        eq(dimeChatGenerations.idempotencyKey, idempotencyKey)
      )
    )
    .limit(1);
  return rows[0];
}

export function rehydrateDimeChatTraceIdentity(
  metadata: string | null,
  requestId: string
): DimeTraceIdentity {
  let parsedMetadata: unknown;
  try {
    parsedMetadata = metadata ? JSON.parse(metadata) : null;
  } catch {
    parsedMetadata = null;
  }
  const candidate =
    parsedMetadata &&
    typeof parsedMetadata === "object" &&
    "identity" in parsedMetadata
      ? (parsedMetadata as { identity?: unknown }).identity
      : null;
  const identity = parseDimeTraceIdentity(candidate);
  if (!identity || identity.requestId !== requestId) {
    throw new DimeChatTracePersistenceError(
      "Trace v1 stored generation identity is missing or invalid."
    );
  }
  return identity;
}

function activeTraceFromRow(row: {
  generationId: string;
  generationRequestId: string;
  acceptedIdentityMetadata: string | null;
  clientAssistantMessageId: string;
  attempt: number;
  turnId: string;
  sessionId: string;
  threadId: number;
  userMessageId: number;
}): ActiveDimeChatTrace {
  const identity = rehydrateDimeChatTraceIdentity(
    row.acceptedIdentityMetadata,
    row.generationRequestId
  );
  return {
    version: DIME_CHAT_TRACE_VERSION,
    requestId: row.generationRequestId,
    chatSessionId: row.sessionId,
    threadId: row.threadId,
    turnId: row.turnId,
    userMessageId: row.userMessageId,
    generationId: row.generationId,
    clientAssistantMessageId: row.clientAssistantMessageId,
    attempt: row.attempt,
    identity,
  };
}

export interface DimeChatTraceStoredRequestSemantics {
  generationInputSha256: string;
  generationHistorySha256: string;
  requestedThreadId: number | null;
  clientSessionId: string;
  clientTurnId: string;
  clientUserMessageId: string | null;
  clientAssistantMessageId: string;
  retryOfGenerationId: string | null;
}

/**
 * Migration-free compatibility for rows written with the original Trace v1
 * fingerprint. All fields come from the durable client-owned request record;
 * no mutable server execution metadata participates in the comparison.
 */
export function matchesDimeChatTraceRequestSemantics(
  stored: DimeChatTraceStoredRequestSemantics,
  input: BeginDimeChatTraceInput,
  inputSha256: string,
  historySha256: string
): boolean {
  return (
    stored.generationInputSha256 === inputSha256 &&
    stored.generationHistorySha256 === historySha256 &&
    stored.requestedThreadId === input.envelope.threadId &&
    stored.clientSessionId === input.envelope.clientSessionId &&
    stored.clientTurnId === input.envelope.clientTurnId &&
    stored.clientUserMessageId === input.envelope.clientUserMessageId &&
    stored.clientAssistantMessageId ===
      input.envelope.clientAssistantMessageId &&
    stored.retryOfGenerationId === (input.envelope.retryOfGenerationId ?? null)
  );
}

function resolveExistingAttempt(
  row: Awaited<ReturnType<typeof findExistingAttempt>>,
  requestFingerprintSha256: string,
  input: BeginDimeChatTraceInput,
  inputSha256: string,
  historySha256: string
): DimeChatTraceBeginResult | null {
  if (!row) return null;
  if (
    row.requestFingerprintSha256 !== requestFingerprintSha256 &&
    !matchesDimeChatTraceRequestSemantics(
      row,
      input,
      inputSha256,
      historySha256
    )
  ) {
    return {
      kind: "conflict",
      reason: "The idempotency key was already used for different input.",
    };
  }

  const trace = activeTraceFromRow(row);
  if (
    (row.generationStatus === "completed" ||
      row.generationStatus === "blocked") &&
    typeof row.servedOutput === "string"
  ) {
    return {
      kind: "replay",
      trace,
      servedOutput: row.servedOutput,
      stopReason: row.finishReason ?? "end_turn",
      dataFreshness: row.contextFreshness,
      status: row.generationStatus,
      assistantMessageId: row.assistantMessageId,
    };
  }
  if (row.generationStatus === "generating") {
    return { kind: "in_progress", trace };
  }
  return { kind: "terminal_error", trace };
}

async function lockOwnedThread(
  tx: Awaited<ReturnType<typeof requireTraceDb>>,
  threadId: number,
  userId: number
) {
  await tx.execute(sql`
    SELECT id
      FROM ${dimeChatThreads}
     WHERE ${dimeChatThreads.id} = ${threadId}
       AND ${dimeChatThreads.userId} = ${userId}
       AND ${dimeChatThreads.deletedAt} IS NULL
     FOR UPDATE
  `);
  const rows = await tx
    .select({ id: dimeChatThreads.id })
    .from(dimeChatThreads)
    .where(
      and(
        eq(dimeChatThreads.id, threadId),
        eq(dimeChatThreads.userId, userId),
        isNull(dimeChatThreads.deletedAt)
      )
    )
    .limit(1);
  if (!rows[0]) {
    throw new DimeChatTracePersistenceError(
      "The requested chat does not exist or is not owned by this user."
    );
  }
}

async function lockTraceThread(
  tx: Awaited<ReturnType<typeof requireTraceDb>>,
  threadId: number
) {
  await tx.execute(sql`
    SELECT id
      FROM ${dimeChatThreads}
     WHERE ${dimeChatThreads.id} = ${threadId}
     FOR UPDATE
  `);
  const rows = await tx
    .select({ id: dimeChatThreads.id })
    .from(dimeChatThreads)
    .where(eq(dimeChatThreads.id, threadId))
    .limit(1);
  if (!rows[0]) {
    throw new DimeChatTracePersistenceError(
      "The Trace v1 chat thread is missing."
    );
  }
}

async function assertNoActiveThreadTurn(
  tx: Awaited<ReturnType<typeof requireTraceDb>>,
  threadId: number,
  exceptTurnId?: string
) {
  const rows = await tx
    .select({ id: dimeChatTurns.id })
    .from(dimeChatTurns)
    .where(
      and(
        eq(dimeChatTurns.threadId, threadId),
        inArray(dimeChatTurns.status, ["generating"])
      )
    )
    .limit(2);
  if (rows.some((row: { id: string }) => row.id !== exceptTurnId)) {
    throw new DimeChatTraceBusyError();
  }
}

async function recoverExpiredThreadTurns(
  tx: Awaited<ReturnType<typeof requireTraceDb>>,
  threadId: number,
  now: Date
): Promise<void> {
  const stale = await tx
    .select({
      turnId: dimeChatTurns.id,
      generationId: dimeChatGenerations.id,
    })
    .from(dimeChatTurns)
    .innerJoin(
      dimeChatGenerations,
      eq(dimeChatGenerations.id, dimeChatTurns.lastGenerationId)
    )
    .where(
      and(
        eq(dimeChatTurns.threadId, threadId),
        eq(dimeChatTurns.status, "generating"),
        eq(dimeChatGenerations.status, "generating"),
        lte(dimeChatGenerations.leaseExpiresAt, now)
      )
    );

  for (const row of stale) {
    await tx
      .update(dimeChatGenerations)
      .set({
        status: "failed",
        errorClass: "GenerationLeaseExpired",
        errorCode: "worker_lease_expired",
        completedAt: now,
      })
      .where(
        and(
          eq(dimeChatGenerations.id, row.generationId),
          eq(dimeChatGenerations.status, "generating")
        )
      );
    await tx
      .update(dimeChatTurns)
      .set({ status: "failed", completedAt: now, updatedAt: now })
      .where(
        and(
          eq(dimeChatTurns.id, row.turnId),
          eq(dimeChatTurns.lastGenerationId, row.generationId),
          eq(dimeChatTurns.status, "generating")
        )
      );
    await tx.insert(dimeChatTraceEvents).values({
      turnId: row.turnId,
      generationId: row.generationId,
      eventType: "generation_lease_expired",
      metadata: safeMetadata({
        leaseMs: DIME_CHAT_TRACE_GENERATION_LEASE_MS,
      }),
      createdAt: now,
    });
  }
}

async function nextMessageSeq(
  tx: Awaited<ReturnType<typeof requireTraceDb>>,
  threadId: number
): Promise<number> {
  const [row] = await tx
    .select({
      maxSeq: sql<number>`COALESCE(MAX(${dimeChatMessages.seq}), 0)`,
    })
    .from(dimeChatMessages)
    .where(eq(dimeChatMessages.threadId, threadId));
  return Number(row?.maxSeq ?? 0) + 1;
}

async function createInitialAttempt(
  db: Awaited<ReturnType<typeof requireTraceDb>>,
  input: BeginDimeChatTraceInput,
  inputSha256: string,
  acceptedHistorySnapshot: string,
  acceptedHistorySha256: string,
  fingerprintSha256: string
): Promise<ActiveDimeChatTrace> {
  const now = new Date();
  const sessionCandidateId = randomUUID();
  const turnId = randomUUID();
  const generationId = randomUUID();

  return db.transaction(
    async (tx: Awaited<ReturnType<typeof requireTraceDb>>) => {
      await tx
        .insert(dimeChatSessions)
        .values({
          id: sessionCandidateId,
          userId: input.userId,
          clientSessionId: input.envelope.clientSessionId,
          policyVersion: DIME_CHAT_TRACE_POLICY_VERSION,
          startedAt: now,
          lastSeenAt: now,
        })
        .onDuplicateKeyUpdate({ set: { lastSeenAt: now } });

      const [session] = await tx
        .select({ id: dimeChatSessions.id })
        .from(dimeChatSessions)
        .where(
          and(
            eq(dimeChatSessions.userId, input.userId),
            eq(dimeChatSessions.clientSessionId, input.envelope.clientSessionId)
          )
        )
        .limit(1);
      if (!session) {
        throw new DimeChatTracePersistenceError(
          "Trace v1 could not establish the chat session."
        );
      }

      let threadId = input.envelope.threadId;
      if (threadId === null) {
        const [inserted] = await tx
          .insert(dimeChatThreads)
          .values({
            userId: input.userId,
            title: deriveTraceThreadTitle(input.userPrompt),
            createdAt: now,
            updatedAt: now,
          })
          .$returningId();
        threadId = Number(inserted?.id);
        if (!Number.isFinite(threadId) || threadId <= 0) {
          throw new DimeChatTracePersistenceError(
            "Trace v1 could not create the chat thread."
          );
        }
      } else {
        await lockOwnedThread(tx, threadId, input.userId);
        await recoverExpiredThreadTurns(tx, threadId, now);
        await assertNoActiveThreadTurn(tx, threadId);
      }

      const seq = await nextMessageSeq(tx, threadId);
      const [insertedMessage] = await tx
        .insert(dimeChatMessages)
        .values({
          threadId,
          sessionId: session.id,
          turnId,
          clientMessageId: input.envelope.clientUserMessageId,
          generationId,
          seq,
          role: "user",
          content: input.userPrompt,
          contentSha256: inputSha256,
          createdAt: now,
        })
        .$returningId();
      const userMessageId = Number(insertedMessage?.id);
      if (!Number.isFinite(userMessageId) || userMessageId <= 0) {
        throw new DimeChatTracePersistenceError(
          "Trace v1 could not persist the user prompt."
        );
      }

      await tx.insert(dimeChatTurns).values({
        id: turnId,
        userId: input.userId,
        sessionId: session.id,
        threadId,
        clientTurnId: input.envelope.clientTurnId,
        userMessageId,
        lastGenerationId: generationId,
        inputSha256,
        requestClass: input.requestClass,
        responseBudget: input.responseBudget,
        status: "generating",
        startedAt: now,
        updatedAt: now,
      });

      await tx.insert(dimeChatGenerations).values({
        id: generationId,
        turnId,
        userId: input.userId,
        requestId: input.requestId,
        idempotencyKey: input.envelope.idempotencyKey,
        requestedThreadId: input.envelope.threadId,
        clientAssistantMessageId: input.envelope.clientAssistantMessageId,
        attempt: 1,
        inputSha256,
        requestFingerprintSha256: fingerprintSha256,
        historySha256: acceptedHistorySha256,
        historySnapshot: acceptedHistorySnapshot,
        provider: input.provider.provider,
        deploymentTier: input.provider.deploymentTier,
        endpointSource: input.provider.endpointSource,
        requestedModel: input.provider.requestedModel,
        baseRevision: input.provider.baseRevision,
        adapterRevision: input.provider.adapterRevision,
        sourceCommit: input.identity.gitCommit,
        productProfile: input.provider.productProfile,
        profileVersion: input.provider.profileVersion,
        promptSource: input.provider.promptSource,
        systemPromptSha256: input.provider.systemPrompt
          ? hashDimeChatTraceText(input.provider.systemPrompt)
          : undefined,
        blueprintHash: input.provider.blueprintHash,
        maxTokens: input.provider.maxTokens,
        temperature:
          input.provider.temperature === undefined
            ? undefined
            : String(input.provider.temperature),
        status: "generating",
        startedAt: now,
        leaseExpiresAt: generationLeaseDeadline(now),
        purgeAfter: retentionDeadline(now),
      });

      await tx.insert(dimeChatTraceEvents).values({
        turnId,
        generationId,
        eventType: "prompt_persisted",
        metadata: safeMetadata({
          identity: input.identity,
          requestClass: input.requestClass,
          responseBudget: input.responseBudget,
          attempt: 1,
          platformKnowledgeVersion: input.provider.platformKnowledgeVersion,
          platformKnowledgeSha256: input.provider.platformKnowledgeSha256,
        }),
        createdAt: now,
      });

      await tx
        .update(dimeChatThreads)
        .set({ updatedAt: now })
        .where(eq(dimeChatThreads.id, threadId));

      return {
        version: DIME_CHAT_TRACE_VERSION,
        requestId: input.requestId,
        chatSessionId: session.id,
        threadId,
        turnId,
        userMessageId,
        generationId,
        clientAssistantMessageId: input.envelope.clientAssistantMessageId,
        attempt: 1,
        identity: input.identity,
      };
    }
  );
}

async function createRetryAttempt(
  db: Awaited<ReturnType<typeof requireTraceDb>>,
  input: BeginDimeChatTraceInput,
  inputSha256: string,
  acceptedHistorySnapshot: string,
  acceptedHistorySha256: string,
  fingerprintSha256: string
): Promise<ActiveDimeChatTrace | null> {
  const retryGenerationId = input.envelope.retryOfGenerationId;
  if (!retryGenerationId) return null;
  const now = new Date();
  const generationId = randomUUID();

  return db.transaction(
    async (tx: Awaited<ReturnType<typeof requireTraceDb>>) => {
      const loadPrior = async () => {
        const rows = await tx
          .select({
            turnId: dimeChatTurns.id,
            sessionId: dimeChatTurns.sessionId,
            threadId: dimeChatTurns.threadId,
            userMessageId: dimeChatTurns.userMessageId,
            turnInputSha256: dimeChatTurns.inputSha256,
            turnStatus: dimeChatTurns.status,
            clientTurnId: dimeChatTurns.clientTurnId,
            clientSessionId: dimeChatSessions.clientSessionId,
            retryStatus: dimeChatGenerations.status,
          })
          .from(dimeChatGenerations)
          .innerJoin(
            dimeChatTurns,
            eq(dimeChatTurns.id, dimeChatGenerations.turnId)
          )
          .innerJoin(
            dimeChatSessions,
            eq(dimeChatSessions.id, dimeChatTurns.sessionId)
          )
          .where(
            and(
              eq(dimeChatGenerations.id, retryGenerationId),
              eq(dimeChatTurns.userId, input.userId)
            )
          )
          .limit(1);
        return rows[0];
      };

      let prior = await loadPrior();
      if (!prior) {
        throw new DimeChatTracePersistenceError(
          "The requested retry generation does not exist."
        );
      }
      await lockOwnedThread(tx, prior.threadId, input.userId);
      await recoverExpiredThreadTurns(tx, prior.threadId, now);
      prior = await loadPrior();
      if (!prior) {
        throw new DimeChatTracePersistenceError(
          "The requested retry generation does not exist."
        );
      }
      if (
        prior.clientSessionId !== input.envelope.clientSessionId ||
        prior.clientTurnId !== input.envelope.clientTurnId ||
        prior.turnInputSha256 !== inputSha256 ||
        (input.envelope.threadId !== null &&
          input.envelope.threadId !== prior.threadId)
      ) {
        throw new DimeChatTracePersistenceError(
          "The requested retry does not match the original turn."
        );
      }
      if (
        !["failed", "aborted"].includes(prior.turnStatus) ||
        !["failed", "aborted"].includes(prior.retryStatus)
      ) {
        throw new DimeChatTracePersistenceError(
          "Only a failed or aborted generation may be retried."
        );
      }

      await assertNoActiveThreadTurn(tx, prior.threadId, prior.turnId);

      const [{ maxAttempt }] = await tx
        .select({
          maxAttempt: sql<number>`COALESCE(MAX(${dimeChatGenerations.attempt}), 0)`,
        })
        .from(dimeChatGenerations)
        .where(eq(dimeChatGenerations.turnId, prior.turnId));
      const attempt = Number(maxAttempt ?? 0) + 1;

      await tx.insert(dimeChatGenerations).values({
        id: generationId,
        turnId: prior.turnId,
        userId: input.userId,
        requestId: input.requestId,
        idempotencyKey: input.envelope.idempotencyKey,
        requestedThreadId: input.envelope.threadId,
        clientAssistantMessageId: input.envelope.clientAssistantMessageId,
        attempt,
        inputSha256,
        requestFingerprintSha256: fingerprintSha256,
        historySha256: acceptedHistorySha256,
        historySnapshot: acceptedHistorySnapshot,
        provider: input.provider.provider,
        deploymentTier: input.provider.deploymentTier,
        endpointSource: input.provider.endpointSource,
        requestedModel: input.provider.requestedModel,
        baseRevision: input.provider.baseRevision,
        adapterRevision: input.provider.adapterRevision,
        sourceCommit: input.identity.gitCommit,
        productProfile: input.provider.productProfile,
        profileVersion: input.provider.profileVersion,
        promptSource: input.provider.promptSource,
        systemPromptSha256: input.provider.systemPrompt
          ? hashDimeChatTraceText(input.provider.systemPrompt)
          : undefined,
        blueprintHash: input.provider.blueprintHash,
        maxTokens: input.provider.maxTokens,
        temperature:
          input.provider.temperature === undefined
            ? undefined
            : String(input.provider.temperature),
        status: "generating",
        startedAt: now,
        leaseExpiresAt: generationLeaseDeadline(now),
        purgeAfter: retentionDeadline(now),
      });
      await tx
        .update(dimeChatTurns)
        .set({
          lastGenerationId: generationId,
          status: "generating",
          completedAt: null,
          updatedAt: now,
        })
        .where(eq(dimeChatTurns.id, prior.turnId));
      await tx.insert(dimeChatTraceEvents).values({
        turnId: prior.turnId,
        generationId,
        eventType: "generation_retry_started",
        metadata: safeMetadata({
          identity: input.identity,
          attempt,
          retryOfGenerationId: retryGenerationId,
          platformKnowledgeVersion: input.provider.platformKnowledgeVersion,
          platformKnowledgeSha256: input.provider.platformKnowledgeSha256,
        }),
        createdAt: now,
      });

      return {
        version: DIME_CHAT_TRACE_VERSION,
        requestId: input.requestId,
        chatSessionId: prior.sessionId,
        threadId: prior.threadId,
        turnId: prior.turnId,
        userMessageId: prior.userMessageId,
        generationId,
        clientAssistantMessageId: input.envelope.clientAssistantMessageId,
        attempt,
        identity: input.identity,
      };
    }
  );
}

/**
 * Persist the accepted prompt and open its generation before any provider
 * call. An idempotent replay never invokes the provider again.
 */
export async function beginDimeChatTrace(
  input: BeginDimeChatTraceInput
): Promise<DimeChatTraceBeginResult> {
  if (input.identity.requestId !== input.requestId) {
    throw new DimeChatTracePersistenceError(
      "Trace v1 request identity does not match the accepted request."
    );
  }
  const db = await requireTraceDb();
  const inputSha256 = hashDimeChatTraceText(input.userPrompt);
  const acceptedHistorySnapshot = historySnapshot(input.history);
  const acceptedHistorySha256 = hashDimeChatTraceText(acceptedHistorySnapshot);
  const fingerprintSha256 = hashDimeChatTraceRequestFingerprint(
    input,
    inputSha256,
    acceptedHistorySha256
  );

  const existing = resolveExistingAttempt(
    await findExistingAttempt(db, input.userId, input.envelope.idempotencyKey),
    fingerprintSha256,
    input,
    inputSha256,
    acceptedHistorySha256
  );
  if (existing) return existing;

  try {
    const retry = await createRetryAttempt(
      db,
      input,
      inputSha256,
      acceptedHistorySnapshot,
      acceptedHistorySha256,
      fingerprintSha256
    );
    if (retry) return { kind: "started", trace: retry };
    return {
      kind: "started",
      trace: await createInitialAttempt(
        db,
        input,
        inputSha256,
        acceptedHistorySnapshot,
        acceptedHistorySha256,
        fingerprintSha256
      ),
    };
  } catch (error) {
    if (error instanceof DimeChatTraceBusyError) {
      return {
        kind: "conflict",
        reason: error.message,
      };
    }
    if (isDuplicateKeyError(error)) {
      const raced = resolveExistingAttempt(
        await findExistingAttempt(
          db,
          input.userId,
          input.envelope.idempotencyKey
        ),
        fingerprintSha256,
        input,
        inputSha256,
        acceptedHistorySha256
      );
      if (raced) return raced;
    }
    if (error instanceof DimeChatTracePersistenceError) throw error;
    throw new DimeChatTracePersistenceError(
      "Trace v1 could not persist the accepted prompt.",
      { cause: error }
    );
  }
}

/** Persist the exact bounded context snapshot before inference. */
export async function recordDimeChatTraceContext(
  trace: ActiveDimeChatTrace,
  input: DimeChatTraceContextInput
): Promise<void> {
  const db = await requireTraceDb();
  const context = validateDimeChatTraceRestrictedText(
    input.context,
    "contextSnapshot"
  );
  const eventIds = validateDimeChatTraceEventIds(input.eventIds);
  const routingMetadata = routingMetadataFromInput(input);
  const observability: DimeTraceContextObservability = {
    toolCall: validateDimeToolCallTrace(input.observability.toolCall),
    timestamps: validateDimeEvidenceTimestamps(input.observability.timestamps),
    providerObservation: validateDimeProviderObservation(
      input.observability.providerObservation
    ),
    ingestionLifecycle: validateDimeIngestionLifecycle(
      input.observability.ingestionLifecycle
    ),
    stageLatency: validateDimeStageLatency(input.observability.stageLatency),
    contextMetrics: validateDimeContextMetrics(
      input.observability.contextMetrics
    ),
    dynamicEvidenceUsed: input.observability.dynamicEvidenceUsed,
  };
  const now = new Date();
  try {
    await db.transaction(
      async (tx: Awaited<ReturnType<typeof requireTraceDb>>) => {
        await lockTraceThread(tx, trace.threadId);
        await tx.execute(sql`
          SELECT id
            FROM ${dimeChatGenerations}
           WHERE ${dimeChatGenerations.id} = ${trace.generationId}
             AND ${dimeChatGenerations.turnId} = ${trace.turnId}
             AND ${dimeChatGenerations.status} = 'generating'
           FOR UPDATE
        `);
        const [generation] = await tx
          .select({ id: dimeChatGenerations.id })
          .from(dimeChatGenerations)
          .where(
            and(
              eq(dimeChatGenerations.id, trace.generationId),
              eq(dimeChatGenerations.turnId, trace.turnId),
              eq(dimeChatGenerations.status, "generating")
            )
          )
          .limit(1);
        if (!generation) {
          throw new DimeChatTracePersistenceError(
            "Trace v1 generation is unavailable for context capture."
          );
        }
        await tx
          .update(dimeChatGenerations)
          .set({
            contextFreshness: input.freshness,
            contextSha256: context ? hashDimeChatTraceText(context) : undefined,
            contextRowCount: input.rowCount,
            contextSnapshot: context,
          })
          .where(eq(dimeChatGenerations.id, trace.generationId));
        await tx.insert(dimeChatTraceEvents).values({
          turnId: trace.turnId,
          generationId: trace.generationId,
          eventType: input.lookupErrorClass
            ? "context_lookup_failed"
            : "context_captured",
          metadata: safeMetadata({
            freshness: input.freshness,
            rowCount: input.rowCount,
            eventIds,
            ...(input.lookupErrorClass
              ? { errorClass: input.lookupErrorClass }
              : {}),
            ...routingMetadata,
            observability,
          }),
          createdAt: now,
        });
      }
    );
    trace.contextObservability = observability;
  } catch (error) {
    throw new DimeChatTracePersistenceError(
      "Trace v1 could not persist model context.",
      { cause: error }
    );
  }
}

/**
 * Atomically persist raw output, exact served output, validation outcome, and
 * the user-visible assistant message before any response text is sent.
 */
export async function finalizeDimeChatTrace(
  trace: ActiveDimeChatTrace,
  input: FinalizeDimeChatTraceInput
): Promise<{ assistantMessageId: number }> {
  const db = await requireTraceDb();
  const rawOutput =
    validateDimeChatTraceRestrictedText(input.rawOutput, "rawOutput") ?? "";
  const servedOutput =
    validateDimeChatTraceRestrictedText(input.servedOutput, "servedOutput") ??
    "";
  const validationErrors =
    validateDimeChatTraceRestrictedText(
      JSON.stringify(input.validationErrors ?? []),
      "validationErrors"
    ) ?? "[]";
  const routingMetadata = routingMetadataFromInput(input);
  if (!servedOutput) {
    throw new DimeChatTracePersistenceError(
      "Trace v1 refuses to persist an empty served response."
    );
  }
  const now = new Date();
  if (!trace.contextObservability) {
    throw new DimeChatTracePersistenceError(
      "Trace v1 refuses to finalize without explicit context/tool observability."
    );
  }
  const contextObservability = trace.contextObservability;
  const stageLatency = validateDimeStageLatency({
    ...contextObservability.stageLatency,
    modelTimeToFirstTokenMs: input.modelTimeToFirstTokenMs ?? null,
    modelCompletionMs: input.modelCompletionMs ?? null,
    validationMs: input.validationMs ?? null,
    endToEndMs: input.latencyMs,
  });
  const timestamps = validateDimeEvidenceTimestamps({
    ...contextObservability.timestamps,
    responseGeneratedAt: now.toISOString(),
  });
  const providerObservation = validateDimeProviderObservation(
    contextObservability.providerObservation
  );
  const ingestionLifecycle = completeDimeIngestionLifecycleForResponse({
    lifecycle: contextObservability.ingestionLifecycle,
    responseGeneratedAt: now.toISOString(),
  });
  const contextMetrics = validateDimeContextMetrics({
    ...contextObservability.contextMetrics,
    inputTokens:
      input.usage?.promptTokens ??
      contextObservability.contextMetrics.inputTokens,
  });
  const cost = estimateDimeTraceCost({
    inputTokens: input.usage?.promptTokens,
    outputTokens: input.usage?.completionTokens,
    cachedInputTokens: input.usage?.cachedInputTokens,
    toolRequestCount: ["not_required", "selected_not_invoked"].includes(
      contextObservability.toolCall.status
    )
      ? 0
      : 1,
    zeroCostRuntime: input.zeroCostRuntime,
    provider: trace.identity.modelProvider,
    model: trace.identity.baseModel,
    modelRevision: trace.identity.modelRevision,
    requestAt: now,
  });
  const traceCompleteness = assessDimeTraceCompleteness({
    identity: trace.identity,
    toolCall: contextObservability.toolCall,
    timestamps,
    providerObservation,
    ingestionLifecycle,
    stageLatency,
    contextMetrics,
    cost,
    dynamicEvidenceUsed: contextObservability.dynamicEvidenceUsed,
  });

  try {
    return await db.transaction(
      async (tx: Awaited<ReturnType<typeof requireTraceDb>>) => {
        // All Trace state transitions use the thread as their first lock.
        await lockTraceThread(tx, trace.threadId);
        await tx.execute(sql`
          SELECT id
            FROM ${dimeChatGenerations}
           WHERE ${dimeChatGenerations.id} = ${trace.generationId}
           FOR UPDATE
        `);
        await tx.execute(sql`
          SELECT id
            FROM ${dimeChatTurns}
           WHERE ${dimeChatTurns.id} = ${trace.turnId}
           FOR UPDATE
        `);
        const [generation] = await tx
          .select({
            status: dimeChatGenerations.status,
            servedOutput: dimeChatGenerations.servedOutput,
            turnId: dimeChatGenerations.turnId,
          })
          .from(dimeChatGenerations)
          .where(eq(dimeChatGenerations.id, trace.generationId))
          .limit(1);
        const [turn] = await tx
          .select({
            assistantMessageId: dimeChatTurns.assistantMessageId,
            sessionId: dimeChatTurns.sessionId,
            threadId: dimeChatTurns.threadId,
          })
          .from(dimeChatTurns)
          .where(eq(dimeChatTurns.id, trace.turnId))
          .limit(1);
        if (
          !generation ||
          !turn ||
          generation.turnId !== trace.turnId ||
          turn.threadId !== trace.threadId
        ) {
          throw new DimeChatTracePersistenceError(
            "Trace v1 generation state is missing."
          );
        }
        if (
          (generation.status === "completed" ||
            generation.status === "blocked") &&
          generation.servedOutput === servedOutput &&
          turn.assistantMessageId
        ) {
          return { assistantMessageId: turn.assistantMessageId };
        }
        if (generation.status !== "generating") {
          throw new DimeChatTracePersistenceError(
            "Trace v1 generation is already terminal."
          );
        }

        const seq = await nextMessageSeq(tx, trace.threadId);
        const [insertedMessage] = await tx
          .insert(dimeChatMessages)
          .values({
            threadId: trace.threadId,
            sessionId: turn.sessionId,
            turnId: trace.turnId,
            clientMessageId: trace.clientAssistantMessageId,
            generationId: trace.generationId,
            seq,
            role: "assistant",
            content: servedOutput,
            contentSha256: hashDimeChatTraceText(servedOutput),
            createdAt: now,
          })
          .$returningId();
        const assistantMessageId = Number(insertedMessage?.id);
        if (!Number.isFinite(assistantMessageId) || assistantMessageId <= 0) {
          throw new DimeChatTracePersistenceError(
            "Trace v1 could not persist the assistant response."
          );
        }

        await tx
          .update(dimeChatGenerations)
          .set({
            status: input.status,
            rawOutput,
            servedOutput,
            actualModel: input.actualModel,
            validationErrors,
            certaintyViolation: input.certaintyViolation ?? false,
            finishReason: input.finishReason ?? undefined,
            promptTokens: input.usage?.promptTokens,
            completionTokens: input.usage?.completionTokens,
            totalTokens: input.usage?.totalTokens,
            latencyMs: input.latencyMs,
            completedAt: now,
          })
          .where(eq(dimeChatGenerations.id, trace.generationId));
        await tx
          .update(dimeChatTurns)
          .set({
            assistantMessageId,
            lastGenerationId: trace.generationId,
            status: input.status,
            completedAt: now,
            updatedAt: now,
          })
          .where(eq(dimeChatTurns.id, trace.turnId));
        await tx
          .update(dimeChatThreads)
          .set({ updatedAt: now })
          .where(eq(dimeChatThreads.id, trace.threadId));
        await tx.insert(dimeChatTraceEvents).values({
          turnId: trace.turnId,
          generationId: trace.generationId,
          eventType:
            input.status === "blocked"
              ? "generation_blocked"
              : "generation_completed",
          metadata: safeMetadata({
            attempt: trace.attempt,
            finishReason: input.finishReason ?? null,
            validationErrorCount: input.validationErrors?.length ?? 0,
            certaintyViolation: input.certaintyViolation ?? false,
            latencyMs: input.latencyMs,
            phase1: {
              stageLatency,
              timestamps,
              providerObservation,
              ingestionLifecycle,
              contextMetrics,
              toolCall: contextObservability.toolCall,
              cost,
              completeness: traceCompleteness,
            },
            ...routingMetadata,
          }),
          createdAt: now,
        });

        return { assistantMessageId };
      }
    );
  } catch (error) {
    if (error instanceof DimeChatTracePersistenceError) throw error;
    throw new DimeChatTracePersistenceError(
      "Trace v1 could not finalize the model response.",
      { cause: error }
    );
  }
}

/** Mark an attempt terminal without storing a user-visible assistant message. */
export async function failDimeChatTrace(
  trace: ActiveDimeChatTrace,
  input: {
    status: "failed" | "aborted";
    errorClass: string;
    errorCode?: string;
    latencyMs: number;
  }
): Promise<void> {
  const db = await requireTraceDb();
  const now = new Date();
  try {
    await db.transaction(
      async (tx: Awaited<ReturnType<typeof requireTraceDb>>) => {
        await lockTraceThread(tx, trace.threadId);
        await tx.execute(sql`
          SELECT id
            FROM ${dimeChatGenerations}
           WHERE ${dimeChatGenerations.id} = ${trace.generationId}
           FOR UPDATE
        `);
        const [generation] = await tx
          .select({
            status: dimeChatGenerations.status,
            turnId: dimeChatGenerations.turnId,
          })
          .from(dimeChatGenerations)
          .where(eq(dimeChatGenerations.id, trace.generationId))
          .limit(1);
        if (!generation || generation.turnId !== trace.turnId) {
          throw new DimeChatTracePersistenceError(
            "Trace v1 generation state is missing."
          );
        }
        if (generation.status !== "generating") return;

        await tx
          .update(dimeChatGenerations)
          .set({
            status: input.status,
            errorClass: input.errorClass.slice(0, 96),
            errorCode: input.errorCode?.slice(0, 64),
            latencyMs: input.latencyMs,
            completedAt: now,
          })
          .where(
            and(
              eq(dimeChatGenerations.id, trace.generationId),
              eq(dimeChatGenerations.status, "generating")
            )
          );
        await tx
          .update(dimeChatTurns)
          .set({
            status: input.status,
            completedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(dimeChatTurns.id, trace.turnId),
              eq(dimeChatTurns.lastGenerationId, trace.generationId),
              eq(dimeChatTurns.status, "generating")
            )
          );
        await tx.insert(dimeChatTraceEvents).values({
          turnId: trace.turnId,
          generationId: trace.generationId,
          eventType:
            input.status === "aborted"
              ? "generation_aborted"
              : "generation_failed",
          metadata: safeMetadata({
            errorClass: input.errorClass.slice(0, 96),
            errorCode: input.errorCode?.slice(0, 64) ?? null,
            latencyMs: input.latencyMs,
          }),
          createdAt: now,
        });
      }
    );
  } catch (error) {
    throw new DimeChatTracePersistenceError(
      "Trace v1 could not record the terminal failure.",
      { cause: error }
    );
  }
}

/** Record a sanitized lifecycle event without prompt/output content. */
export async function appendDimeChatTraceEvent(
  trace: ActiveDimeChatTrace,
  eventType: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  const db = await requireTraceDb();
  await db.insert(dimeChatTraceEvents).values({
    turnId: trace.turnId,
    generationId: trace.generationId,
    eventType: eventType.slice(0, 64),
    metadata: safeMetadata(metadata),
  });
}

/**
 * Delete restricted raw/context payloads at their 90-day deadline while
 * retaining non-content operational metrics and user-visible chat history.
 */
export async function purgeExpiredDimeChatTraceData(
  now = new Date()
): Promise<number> {
  const db = await requireTraceDb();
  const result = await db
    .update(dimeChatGenerations)
    .set({
      rawOutput: null,
      historySnapshot: null,
      contextSnapshot: null,
      contextSha256: null,
      validationErrors: null,
    })
    .where(
      and(
        lte(dimeChatGenerations.purgeAfter, now),
        or(
          isNotNull(dimeChatGenerations.rawOutput),
          isNotNull(dimeChatGenerations.historySnapshot),
          isNotNull(dimeChatGenerations.contextSnapshot),
          isNotNull(dimeChatGenerations.validationErrors)
        )
      )
    );
  const header = result as unknown as {
    affectedRows?: number;
    rowsAffected?: number;
  };
  return Number(header.affectedRows ?? header.rowsAffected ?? 0);
}

/** Start one daily restricted-payload purge on the designated writer service. */
export function startDimeChatTraceRetentionScheduler(): void {
  if (!isDimeChatTraceEnabled()) return;
  const run = () => {
    purgeExpiredDimeChatTraceData()
      .then(purged => {
        console.log(
          `[DimeTrace] retention purge complete: ${purged} generation(s) sanitized`
        );
      })
      .catch((error: unknown) => {
        console.error("[DimeTrace] retention purge failed", {
          errorClass: (error as Error)?.constructor?.name ?? "Unknown",
        });
      });
  };
  const startupTimer = setTimeout(run, 60_000);
  startupTimer.unref();
  const interval = setInterval(run, 24 * 60 * 60 * 1_000);
  interval.unref();
}
