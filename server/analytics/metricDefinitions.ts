/**
 * metricDefinitions.ts — versioned, typed source-of-truth for the admin
 * "User Activity" metrics, plus the PURE (DB-free, unit-tested) helpers that
 * turn raw counts into honest data-states.
 *
 * Owner directive 2026-07-23: the User Activity screen must never render a
 * fabricated zero. When the required instrumentation has produced no data, a
 * metric must read `Not measured` (with an exact reason), NOT `0` / `00:00:00`.
 * Overlapping membership populations must never be shown as separate totals.
 *
 * This module holds only definitions + pure functions so the honesty logic is
 * testable without a database. server/db.ts calls these; server/routers/metrics.ts
 * passes the shapes through; the admin UI renders the states.
 */

/** Bump when any metric definition below changes (numerator/denominator/window). */
export const METRIC_DEFINITION_VERSION = "ua-metrics-v1";

/** All windows and boundaries are computed in UTC. */
export const REPORTING_TIMEZONE = "UTC";

/**
 * Active-user contract (v1). An "active user" is a distinct ELIGIBLE user with
 * a FOREGROUND session (a session row is only created when the app is actually
 * opened in the foreground — never from having a valid auth cookie) whose most
 * recent activity (lastHeartbeat) falls in the rolling window. This is stronger
 * than "authenticated / logged in", but it counts foreground OPENS/activity and
 * does not yet distinguish session depth — depth-based qualifying activity is
 * the next phase (analytics_events). Eligible excludes staff (role owner/admin).
 * Rolling windows: DAU [t-24h,t), WAU [t-7d,t), MAU [t-30d,t).
 *
 * Completeness caveat: average engaged duration + the histogram only count
 * CLOSED sessions. Sessions never cleanly closed (browser crash before
 * logout/pagehide) are finalized opportunistically by closeIdleSessions() on
 * read, but a session whose client dies mid-window stays open until then, so
 * duration stats are biased slightly toward cleanly-closed sessions.
 */
export const ACTIVE_USER_DEFINITION_V1 =
  "distinct eligible (non-staff) user with a foreground session (app opened in the foreground) whose most recent activity falls in the rolling window; v1 counts foreground opens/activity, not session depth";

/** Staff roles excluded from active-user / engagement metrics. */
export const STAFF_ROLES = ["owner", "admin"] as const;

/** True when a role is staff (owner/admin) — excluded from real analytics metrics. */
export function isStaffRole(role: string | null | undefined): boolean {
  return role != null && (STAFF_ROLES as readonly string[]).includes(role);
}

/**
 * Data-state vocabulary (owner directive). `0` is reserved for a genuine, valid
 * measurement whose numerator is zero — never a stand-in for missing data.
 */
export type MetricState =
  | "ok" //           valid measurement (value may legitimately be 0)
  | "not_measured" // required instrumentation produced no data at all
  | "incomplete" //   ingestion partial or observation window immature
  | "stale" //        source exceeded its freshness budget
  | "unknown"; //     a required input/denominator is absent or conflicting

export interface MetricPoint {
  state: MetricState;
  /** Present only when state === "ok" (or a disclosed estimate). Never a fabricated 0. */
  value: number | null;
  /** Exact reason the metric is not "ok". null when state === "ok". */
  reason: string | null;
}

export function ok(value: number): MetricPoint {
  return { state: "ok", value, reason: null };
}
export function notMeasured(reason: string): MetricPoint {
  return { state: "not_measured", value: null, reason };
}
export function incomplete(reason: string): MetricPoint {
  return { state: "incomplete", value: null, reason };
}
export function unknown(reason: string): MetricPoint {
  return { state: "unknown", value: null, reason };
}

const NO_ENGAGED_SESSIONS_REASON =
  "No foreground sessions recorded yet — session instrumentation was newly wired into the live app; DAU/WAU/MAU require heartbeat-bearing session data.";
const DB_UNAVAILABLE_REASON = "Analytics database unavailable — metric could not be measured.";
const NO_CLOSED_SESSIONS_REASON =
  "No valid closed foreground sessions in the last 30 days — average engaged duration cannot be measured.";

/**
 * Active-user point. If the platform has recorded ZERO engaged sessions ever,
 * a windowed count of 0 means "not measured" (nothing is instrumented), not a
 * real zero. Once any engaged session exists, a windowed 0 is a valid `ok` zero.
 */
export function deriveActiveUserPoint(
  windowCount: number,
  totalEngagedSessionsEver: number,
): MetricPoint {
  if (totalEngagedSessionsEver <= 0) return notMeasured(NO_ENGAGED_SESSIONS_REASON);
  return ok(windowCount);
}

/** Average engaged duration. No closed sessions ⇒ not measured (never 00:00:00). */
export function deriveAvgDurationPoint(
  avgMs: number,
  closedSessionCount: number,
): MetricPoint {
  if (closedSessionCount <= 0) return notMeasured(NO_CLOSED_SESSIONS_REASON);
  return ok(avgMs);
}

/** The whole-panel state when the DB itself is unreachable. */
export function dbUnavailablePoint(): MetricPoint {
  return notMeasured(DB_UNAVAILABLE_REASON);
}

export interface MembershipBreakdown {
  /** Total accounts (the denominator every bucket is a slice of). */
  totalMembers: number;
  /** hasAccess && no expiry — a SUBSET of active-access members. */
  lifetime: number;
  /** hasAccess && expiry in the future — the recurring/time-limited slice. */
  recurringPaid: number;
  /** No active access (expired or never granted). */
  noAccess: number;
  /** Discord-linked — CROSS-CUTS every bucket above; never additive with them. */
  discordConnected: number;
  /** Human-readable overlap note the UI must surface. */
  overlapNote: string;
}

/**
 * Reconcile membership so overlapping populations are never presented as
 * separate totals. Input counts come from getMemberMetrics' queries:
 *   totalUsers      — COUNT(*) app_users
 *   payingActive    — hasAccess && (no expiry OR expiry>now)   [⊇ lifetime]
 *   lifetime        — hasAccess && expiry IS NULL
 *   discordConnected— discordId IS NOT NULL                     [cross-cutting]
 * Produces mutually-exclusive buckets (lifetime + recurringPaid + noAccess =
 * totalMembers) plus the cross-cutting discord count.
 */
export function reconcileMembership(
  totalUsers: number,
  payingActive: number,
  lifetime: number,
  discordConnected: number,
): MembershipBreakdown {
  const safeTotal = Math.max(0, totalUsers);
  const safePaying = Math.min(Math.max(0, payingActive), safeTotal);
  const safeLifetime = Math.min(Math.max(0, lifetime), safePaying);
  const recurringPaid = Math.max(0, safePaying - safeLifetime);
  const noAccess = Math.max(0, safeTotal - safePaying);
  return {
    totalMembers: safeTotal,
    lifetime: safeLifetime,
    recurringPaid,
    noAccess,
    discordConnected: Math.min(Math.max(0, discordConnected), safeTotal),
    overlapNote:
      "Lifetime + Recurring + No-access sum to total accounts. Discord-linked cross-cuts every bucket and is never added to the total.",
  };
}
