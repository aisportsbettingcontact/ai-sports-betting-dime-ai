/**
 * eventStore.ts — storage + pure-validation core for the analytics ingestion seam.
 *
 * This module deliberately owns TWO things so both are unit-testable without a
 * live DB and without pulling in the tRPC/appUsers import chain:
 *
 *   1. The PURE, server-authoritative validation of a client `track` payload
 *      (`parseTrackInput`) — event-name allowlist, required schema version,
 *      bounded payload, and the stripping/ignoring of any forged identity or
 *      sensitive fields the client tries to smuggle in.
 *
 *   2. The idempotent, parameterized write (`insertAnalyticsEvent`) keyed on the
 *      client-supplied `eventId`. Re-delivery of the same eventId is a no-op.
 *
 * IDENTITY RULE: the store NEVER trusts client identity. `subjectId` is passed in
 * by the router from `ctx.appUser.id` (server-derived). `receivedAtUtc` is stamped
 * server-side here. The client cannot set either.
 *
 * PRIVACY RULE: no PII, chat text, wager amounts, losses, balances, or
 * payment/entitlement/consent state is ever accepted or stored. `props` is limited
 * to an allowlist of non-sensitive scalar keys.
 *
 * NOTE: `getDb` is imported dynamically inside `insertAnalyticsEvent` so that
 * importing this module (e.g. from a unit test) does NOT load the DB layer. Tests
 * inject a fake `db` and the real DB module is never touched.
 */
import { z } from "zod";
import { analyticsEvents, type InsertAnalyticsEvent } from "../../drizzle/schema";

/**
 * Event allowlist — past-tense, lower_snake_case. Only these names are accepted.
 * Anything else is rejected by `parseTrackInput`. Emitters ship in a later phase;
 * this is the contract they must target.
 */
export const ANALYTICS_EVENT_ALLOWLIST = [
  "feed_viewed",
  "projection_card_expanded",
  "sport_tab_switched",
  "chat_session_started",
  "chat_message_sent",
  "checkout_started",
  "checkout_completed",
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENT_ALLOWLIST)[number];

/** Emission surfaces the client may declare. Server-validated; defaults to 'web'. */
export const ANALYTICS_SOURCE_ALLOWLIST = ["web", "ios", "android", "server"] as const;

/**
 * Allowlisted, non-sensitive prop keys. Values are bounded scalars only. Any key
 * NOT in this list is stripped. This is the second line of defense (after the zod
 * strip of unknown top-level keys) against sensitive data leaking into `propsJson`.
 */
export const ANALYTICS_PROP_KEY_ALLOWLIST = [
  "sport",
  "tab",
  "surface",
  "cardType",
  "position",
  "durationMs",
  "count",
  "variant",
] as const;

const MAX_PROP_KEYS = 12;
const MAX_STRING_LEN = 128;

/** Bounded scalar prop value: short string, finite number, or boolean. No objects/arrays. */
const propValueSchema = z.union([
  z.string().max(MAX_STRING_LEN),
  z.number().finite(),
  z.boolean(),
]);

/**
 * The zod schema for a client `track` payload. By default zod OBJECTS STRIP
 * unknown top-level keys, so any forged `subjectId`, `userId`, `role`,
 * `entitlement`, `consent`, `payment`, `amount`, etc. supplied by the client is
 * silently dropped here — it is simply not part of the accepted shape.
 */
export const trackInputSchema = z
  .object({
    /** Client-generated idempotency key. */
    eventId: z.string().min(8).max(64),
    /** Must be in the allowlist. Unknown names are rejected. */
    eventName: z.enum(ANALYTICS_EVENT_ALLOWLIST),
    /** REQUIRED — versions the payload contract for this eventName. */
    schemaVersion: z.number().int().positive().max(1_000_000),
    /** UTC ms when the event occurred on the client. Bounded to sane range. */
    occurredAtUtc: z
      .number()
      .int()
      .positive()
      .max(4_102_444_800_000 /* year 2100 */),
    /** Optional opaque client session id. */
    sessionId: z.string().min(1).max(64).optional(),
    /** Optional emission surface; defaults to 'web'. */
    source: z.enum(ANALYTICS_SOURCE_ALLOWLIST).default("web"),
    /** Optional coarse outcome label. */
    outcome: z.string().min(1).max(32).optional(),
    /** Optional coarse, non-sensitive data-state label. */
    dataState: z.string().min(1).max(32).optional(),
    /** Optional allowlisted scalar props. */
    props: z.record(z.string(), propValueSchema).optional(),
  })
  .strip();

export type TrackInput = z.infer<typeof trackInputSchema>;

/** The sanitized, server-trusted shape produced from a raw client payload. */
export type SanitizedTrackEvent = {
  eventId: string;
  eventName: AnalyticsEventName;
  schemaVersion: number;
  occurredAtUtc: number;
  sessionId: string | null;
  source: (typeof ANALYTICS_SOURCE_ALLOWLIST)[number];
  outcome: string | null;
  dataState: string | null;
  /** Already allowlist-filtered and bounded. Null when no valid props remain. */
  props: Record<string, string | number | boolean> | null;
};

/**
 * Filter a props object down to the allowlisted keys, cap the key count, and drop
 * everything else. Returns null when nothing survives.
 */
export function sanitizeProps(
  props: Record<string, string | number | boolean> | undefined,
): Record<string, string | number | boolean> | null {
  if (!props) return null;
  const allow = new Set<string>(ANALYTICS_PROP_KEY_ALLOWLIST);
  const out: Record<string, string | number | boolean> = {};
  let n = 0;
  for (const [k, v] of Object.entries(props)) {
    if (!allow.has(k)) continue; // strip non-allowlisted (incl. any smuggled sensitive) keys
    if (n >= MAX_PROP_KEYS) break;
    out[k] = v;
    n++;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * PURE validation + sanitization of a raw client `track` payload.
 *
 * - Throws a `ZodError` when the event name is not allowlisted or when
 *   `schemaVersion` (or any other required field) is missing/invalid.
 * - Silently drops any forged identity / sensitive top-level fields (zod strip).
 * - Never derives or trusts a subject id — that is added by the caller (router)
 *   from `ctx.appUser.id`.
 *
 * @throws {z.ZodError} on invalid input.
 */
export function parseTrackInput(raw: unknown): SanitizedTrackEvent {
  const parsed = trackInputSchema.parse(raw);
  return {
    eventId: parsed.eventId,
    eventName: parsed.eventName,
    schemaVersion: parsed.schemaVersion,
    occurredAtUtc: parsed.occurredAtUtc,
    sessionId: parsed.sessionId ?? null,
    source: parsed.source,
    outcome: parsed.outcome ?? null,
    dataState: parsed.dataState ?? null,
    props: sanitizeProps(parsed.props),
  };
}

/** Minimal structural type for the drizzle db handle we depend on (real or fake). */
export interface AnalyticsDbLike {
  insert: (table: typeof analyticsEvents) => {
    values: (row: InsertAnalyticsEvent) => Promise<unknown>;
  };
}

/** Result of an ingestion attempt. `deduped` = the eventId already existed. */
export type IngestResult = { ok: true; deduped: boolean };

/** True when an error is a MySQL duplicate-key violation (ER_DUP_ENTRY / errno 1062). */
export function isDuplicateKeyError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; errno?: unknown };
  return e.code === "ER_DUP_ENTRY" || e.errno === 1062;
}

/**
 * The server-trusted input to a write: a sanitized event plus the SERVER-DERIVED
 * `subjectId` and `environment`. The client can influence neither.
 */
export type InsertAnalyticsEventInput = SanitizedTrackEvent & {
  /** Server-derived app_users.id (from ctx.appUser.id). Pseudonymous, not PII. */
  subjectId: number;
  /** Server-derived deployment environment. */
  environment: string;
};

/**
 * Idempotently persist one analytics event. Keyed on `eventId` (UNIQUE):
 * re-delivery of the same eventId is a no-op that returns `{ deduped: true }`.
 *
 * `receivedAtUtc` is stamped here from the server clock — never from the client.
 * The write is fully parameterized via drizzle (no string concatenation).
 *
 * @param input   sanitized event + server-derived subjectId/environment.
 * @param dbOverride optional db handle for tests; when omitted the real `getDb()`
 *                   is loaded lazily so this module stays DB-free at import time.
 */
export async function insertAnalyticsEvent(
  input: InsertAnalyticsEventInput,
  dbOverride?: AnalyticsDbLike,
): Promise<IngestResult> {
  const db = dbOverride ?? (await resolveDb());

  const row: InsertAnalyticsEvent = {
    eventId: input.eventId,
    eventName: input.eventName,
    schemaVersion: input.schemaVersion,
    subjectId: input.subjectId,
    sessionId: input.sessionId,
    source: input.source,
    environment: input.environment,
    occurredAtUtc: input.occurredAtUtc,
    receivedAtUtc: Date.now(), // server clock — authoritative
    outcome: input.outcome,
    dataState: input.dataState,
    propsJson: input.props ? JSON.stringify(input.props) : null,
  };

  try {
    await db.insert(analyticsEvents).values(row);
    return { ok: true, deduped: false };
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      // Same eventId already stored — idempotent no-op, not an error.
      return { ok: true, deduped: true };
    }
    throw err;
  }
}

/** Lazily load the real DB handle. Isolated so unit tests never import db.ts. */
async function resolveDb(): Promise<AnalyticsDbLike> {
  const { getDb } = await import("../db");
  const db = await getDb();
  if (!db) throw new Error("[analytics] Database unavailable");
  return db as unknown as AnalyticsDbLike;
}
