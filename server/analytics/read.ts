/**
 * read.ts — device-aware admin overview from the DEDICATED MySQL: Dime AI.
 * Store-role only (guard()); never touches TiDB. Read failures degrade to an
 * honest not_measured payload — never throws to the product.
 *
 * Aggregates plus PSEUDONYMOUS per-user profiling rows (source_user_id + derived
 * scores) — still NO PII in this store. Display identity (username/discord/role)
 * is joined at READ time on the web instance, never persisted here.
 */
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { isAnalyticsStore } from "./config";
import { QUALIFYING_EVENTS } from "./events";
import { ok, notMeasured, type MetricPoint } from "./metricDefinitions";
import { computePowerScore } from "./powerScore";
import { classifySegment, SEGMENT_ORDER, SEGMENT_LABELS, type SegmentKey, type UserFacts } from "./segments";

const TAG = "[analytics][read]";
const DAY = 24 * 60 * 60 * 1000;

export interface DeviceSlice {
  deviceType: string;
  users: number;
  valueEvents: number;
  /** action_performed events on this device (D3). */
  actions: number;
}

/** One curated action and how many times it fired (top-N, D3). */
export interface ActionCount {
  name: string;
  count: number;
}

/**
 * One user's profiling row (P0). Pseudonymous from the store (identity fields
 * null); the web read-time join fills username/discordUsername/role for the
 * owner-only view. Ranked by power score.
 */
export interface UserProfileRow {
  sourceUserId: number;
  score: number;
  tier: string;
  segment: SegmentKey;
  valueEvents: number;
  actionEvents: number;
  activeDays: number;
  distinctSurfaces: number;
  sessions: number;
  lastActive: number;
  username: string | null;
  discordUsername: string | null;
  role: string | null;
}

/** One segment and how many users fall in it (P1). */
export interface SegmentSlice {
  key: SegmentKey;
  label: string;
  users: number;
}

/** One lifecycle funnel stage and how many users have reached it (P1/P2). */
export interface FunnelStage {
  key: string;
  label: string;
  users: number;
}

/** One product surface scored on the four strength axes (P1). Axes are 0–100
 *  or null when not measurable; verdict is the KEEP/INVEST/FIX/CUT quadrant. */
export interface FeatureScore {
  surface: string;
  adoption: number;
  engagement: number;
  stickiness: number | null;
  valueLinkage: number;
  composite: number;
  verdict: "keep" | "invest" | "fix" | "cut";
}

/** One weekly signup cohort and its week-by-week retention % (P2). null = future. */
export interface RetentionCohort {
  cohortWeek: string; // ISO date of the week's Monday (UTC)
  size: number;
  retention: Array<number | null>; // index 0 = W0 (100), 1 = W1, …
}

/**
 * One day on the 30-day activity trend. Continuous + zero-filled so the chart
 * reads as a real timeline: a zero-day is a MEASURED zero (pipeline is on that
 * day), not a fabricated one, so it is honest to draw it.
 */
export interface DailyPoint {
  day: string; // ISO date (UTC), YYYY-MM-DD
  activeUsers: number; // distinct source_user_id active that day
  valueEvents: number; // qualifying value events that day
}

/** Cap on per-user rows returned to the leaderboard/profiler. */
export const TOP_USERS_LIMIT = 25;
/** Safety cap on the per-user aggregate scan (small base; guards a runaway). */
const USER_SCAN_CAP = 5000;
const WEEK = 7 * DAY;
/** Weekly retention window (cohorts + columns). */
const RETENTION_WEEKS = 8;

export interface AnalyticsOverview {
  state: "ok" | "not_measured" | "error";
  reason: string | null;
  asOf: number;
  dau: MetricPoint;
  wau: MetricPoint;
  mau: MetricPoint;
  valueEventsTotal: MetricPoint;
  /** D3: total action_performed events (all time, non-test). */
  totalActions: MetricPoint;
  /** D3: distinct curated action_name values seen (all time, non-test). */
  uniqueActions: MetricPoint;
  /** D3: the most-used curated actions, count-desc (≤5). Empty when none. */
  topActions: ActionCount[];
  /** P0: per-user profiling rows, ranked by power score (≤ TOP_USERS_LIMIT).
   *  Pseudonymous from the store; identity joined at read time on the web. */
  topUsers: UserProfileRow[];
  /** P1: behavioral segment distribution. */
  segments: SegmentSlice[];
  /** P1/P2: lifecycle funnel stages. */
  funnel: FunnelStage[];
  /** P1: per-surface feature-strength scorecard. */
  featureScorecard: FeatureScore[];
  /** P2: weekly retention cohorts. */
  retention: RetentionCohort[];
  /** 30-day daily activity trend (continuous, zero-filled). Empty when disabled. */
  dailyActivity: DailyPoint[];
  lastEventAt: number | null;
  deviceMix: DeviceSlice[];
}

export function overviewWindows(asOf: number): { dayFrom: number; weekFrom: number; monthFrom: number } {
  return { dayFrom: asOf - DAY, weekFrom: asOf - 7 * DAY, monthFrom: asOf - 30 * DAY };
}

const NO_DATA =
  "No analytics events recorded yet — the pipeline is enabled but no qualifying events have arrived.";

/** Honest not_measured payload — no fabricated zeros. Also the disabled/error base. */
export function disabledOverview(reason: string): AnalyticsOverview {
  const asOf = Date.now();
  return {
    state: "not_measured",
    reason,
    asOf,
    dau: notMeasured(reason),
    wau: notMeasured(reason),
    mau: notMeasured(reason),
    valueEventsTotal: notMeasured(reason),
    totalActions: notMeasured(reason),
    uniqueActions: notMeasured(reason),
    topActions: [],
    topUsers: [],
    segments: [],
    funnel: [],
    featureScorecard: [],
    retention: [],
    dailyActivity: [],
    lastEventAt: null,
    deviceMix: [],
  };
}

/**
 * Rows from a drizzle/mysql2 `.execute()` result. mysql2 returns `[rows, fields]`
 * (this repo's idiom: `(await db.execute(sql`…`))[0]` is the Row[]). Defends
 * across that tuple shape and a `{ rows }` shape.
 */
export function rowsOf(result: unknown): Array<Record<string, unknown>> {
  const r = Array.isArray(result) ? result[0] : (result as { rows?: unknown[] })?.rows;
  return Array.isArray(r) ? (r as Array<Record<string, unknown>>) : [];
}

/** First-row scalar column as a number (mysql2 may return BIGINT/COUNT as string). */
export function numAt(result: unknown, key = "n"): number {
  const v = rowsOf(result)[0]?.[key];
  return typeof v === "number" ? v : Number(v ?? 0) || 0;
}

/** Coerce a single row value to a number (mysql2 returns COUNT/SUM as strings). */
const toNum = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0) || 0);

/**
 * Feature-strength scorecard, computed purely from per-user facts (no extra SQL).
 * Adoption = surface users / all users. Engagement = per-user action intensity,
 * min-max normalized across surfaces. Value-linkage = share of surface users who
 * are value users. Stickiness needs a two-window pass (P2) → null (honest). The
 * verdict is the KEEP/INVEST/FIX/CUT quadrant on reach × value-linkage.
 */
export function computeScorecard(facts: readonly UserFacts[]): FeatureScore[] {
  const total = facts.length || 1;
  const defs: Array<{ surface: string; used: (f: UserFacts) => boolean; events: (f: UserFacts) => number }> = [
    { surface: "feed", used: (f) => f.feedActions > 0, events: (f) => f.feedActions },
    { surface: "chat", used: (f) => f.chatActions > 0, events: (f) => f.chatActions },
    { surface: "splits", used: (f) => f.splitsActions > 0, events: (f) => f.splitsActions },
    { surface: "tracker", used: (f) => f.trackerValue > 0, events: (f) => f.trackerValue },
  ];
  // Raw intensity per surface (events / surface-user) for min-max normalization.
  const raw = defs.map((d) => {
    const users = facts.filter(d.used);
    const ev = users.reduce((s, f) => s + d.events(f), 0);
    return users.length ? ev / users.length : 0;
  });
  const maxRaw = Math.max(...raw, 1);
  return defs.map((d, i) => {
    const users = facts.filter(d.used);
    const n = users.length;
    const adoption = Math.round((n / total) * 100);
    const engagement = Math.round((raw[i] / maxRaw) * 100);
    const valueUsers = users.filter((f) => f.valueEvents > 0).length;
    const valueLinkage = n ? Math.round((valueUsers / n) * 100) : 0;
    // Composite over the three measured axes (stickiness reserved for P2), weights renormalized.
    const composite = Math.round((0.25 * adoption + 0.2 * engagement + 0.3 * valueLinkage) / 0.75);
    const reachHigh = adoption >= 35;
    const valueHigh = valueLinkage >= 45;
    const verdict: FeatureScore["verdict"] = valueHigh
      ? reachHigh
        ? "keep"
        : "invest"
      : reachHigh
        ? "fix"
        : "cut";
    return { surface: d.surface, adoption, engagement, stickiness: null, valueLinkage, composite, verdict };
  });
}

/** Owner-directive honest overview. Store-role only. Never throws. */
export async function getAnalyticsOverview(): Promise<AnalyticsOverview> {
  if (!isAnalyticsStore()) {
    return disabledOverview("analytics store not configured on this instance");
  }
  const asOf = Date.now();
  const { dayFrom, weekFrom, monthFrom } = overviewWindows(asOf);
  const names = QUALIFYING_EVENTS as readonly string[];
  const nameList = sql.join(
    names.map((n) => sql`${n}`),
    sql`, `,
  );
  try {
    const db = await getDb();
    if (!db) return disabledOverview("analytics database unavailable");

    const distinct = async (from: number): Promise<number> => {
      const r = await db.execute(sql`
        SELECT COUNT(DISTINCT source_user_id) AS n FROM analytics_events
        WHERE is_test = 0 AND event_name IN (${nameList})
          AND occurred_at_utc >= ${from} AND occurred_at_utc < ${asOf}`);
      return numAt(r);
    };
    const dauN = await distinct(dayFrom);
    const wauN = await distinct(weekFrom);
    const mauN = await distinct(monthFrom);

    const totalR = await db.execute(sql`
      SELECT COUNT(*) AS n FROM analytics_events
      WHERE is_test = 0 AND event_name IN (${nameList})`);
    const total = numAt(totalR);

    const freshR = await db.execute(
      sql`SELECT MAX(occurred_at_utc) AS n FROM analytics_events WHERE is_test = 0`,
    );
    const lastEventAt = numAt(freshR) || null;

    const mixR = await db.execute(sql`
      SELECT COALESCE(device_type, 'unknown') AS device_type,
             COUNT(DISTINCT source_user_id) AS users,
             SUM(CASE WHEN event_name IN (${nameList}) THEN 1 ELSE 0 END) AS value_events,
             SUM(CASE WHEN event_name = 'action_performed' THEN 1 ELSE 0 END) AS actions
      FROM analytics_events WHERE is_test = 0
      GROUP BY COALESCE(device_type, 'unknown')`);
    const deviceMix: DeviceSlice[] = rowsOf(mixR).map((r) => ({
      deviceType: String(r.device_type ?? "unknown"),
      users: Number(r.users ?? 0) || 0,
      valueEvents: Number(r.value_events ?? 0) || 0,
      actions: Number(r.actions ?? 0) || 0,
    }));

    // D3 action metrics — action_performed only, non-test.
    const totalActionsR = await db.execute(sql`
      SELECT COUNT(*) AS n FROM analytics_events
      WHERE is_test = 0 AND event_name = 'action_performed'`);
    const totalActionsN = numAt(totalActionsR);

    const uniqueActionsR = await db.execute(sql`
      SELECT COUNT(DISTINCT action_name) AS n FROM analytics_events
      WHERE is_test = 0 AND event_name = 'action_performed' AND action_name IS NOT NULL`);
    const uniqueActionsN = numAt(uniqueActionsR);

    const topActionsR = await db.execute(sql`
      SELECT action_name AS name, COUNT(*) AS n FROM analytics_events
      WHERE is_test = 0 AND event_name = 'action_performed' AND action_name IS NOT NULL
      GROUP BY action_name ORDER BY n DESC LIMIT 5`);
    const topActions: ActionCount[] = rowsOf(topActionsR).map((r) => ({
      name: String(r.name ?? "unknown"),
      count: Number(r.n ?? 0) || 0,
    }));

    // Per-user aggregate scan (30-day window, non-test), with per-surface columns
    // so we can score, segment, and build the funnel/scorecard in one pass.
    // Pseudonymous — identity is joined at read time on the web.
    const usersR = await db.execute(sql`
      SELECT source_user_id AS uid,
             COUNT(DISTINCT FLOOR(occurred_at_utc / 86400000)) AS active_days,
             COUNT(DISTINCT session_id) AS sessions,
             MAX(occurred_at_utc) AS last_active,
             SUM(CASE WHEN event_name IN (${nameList}) THEN 1 ELSE 0 END) AS value_events,
             SUM(CASE WHEN event_name = 'action_performed' THEN 1 ELSE 0 END) AS action_events,
             SUM(CASE WHEN action_name LIKE 'feed_%' OR action_name LIKE 'projection_%' THEN 1 ELSE 0 END) AS feed_actions,
             SUM(CASE WHEN action_name LIKE 'chat_%' THEN 1 ELSE 0 END) AS chat_actions,
             SUM(CASE WHEN action_name LIKE 'splits_%' THEN 1 ELSE 0 END) AS splits_actions,
             SUM(CASE WHEN event_name = 'tracker_entry_saved' OR action_name LIKE 'bet_%' THEN 1 ELSE 0 END) AS tracker_value,
             COUNT(DISTINCT CASE
               WHEN route LIKE '/feed%' OR action_name LIKE 'feed_%' OR action_name LIKE 'projection_%' THEN 'feed'
               WHEN route LIKE '/chat%' OR action_name LIKE 'chat_%' THEN 'chat'
               WHEN route LIKE '/splits%' OR action_name LIKE 'splits_%' THEN 'splits'
               WHEN route LIKE '/tracker%' OR action_name LIKE 'bet_%' OR event_name = 'tracker_entry_saved' THEN 'tracker'
               ELSE NULL END) AS surfaces
      FROM analytics_events
      WHERE is_test = 0 AND occurred_at_utc >= ${monthFrom}
      GROUP BY source_user_id
      LIMIT ${USER_SCAN_CAP}`);
    const scanned = rowsOf(usersR).map((r) => {
      const lastActive = toNum(r.last_active);
      const facts: UserFacts = {
        daysSinceLastActive: Math.max(0, Math.floor((asOf - lastActive) / DAY)),
        activeDays: toNum(r.active_days),
        distinctSurfaces: toNum(r.surfaces),
        valueEvents: toNum(r.value_events),
        actionEvents: toNum(r.action_events),
        sessions: toNum(r.sessions),
        feedActions: toNum(r.feed_actions),
        chatActions: toNum(r.chat_actions),
        splitsActions: toNum(r.splits_actions),
        trackerValue: toNum(r.tracker_value),
      };
      const { score, tier } = computePowerScore(facts);
      return { uid: toNum(r.uid), lastActive, facts, score, tier, segment: classifySegment(facts) };
    });

    // Segment distribution.
    const segCounts = new Map<SegmentKey, number>();
    for (const u of scanned) segCounts.set(u.segment, (segCounts.get(u.segment) ?? 0) + 1);
    const segments: SegmentSlice[] = SEGMENT_ORDER.map((k) => ({
      key: k,
      label: SEGMENT_LABELS[k],
      users: segCounts.get(k) ?? 0,
    }));

    // Lifecycle funnel (threshold counts over the window).
    const cnt = (pred: (f: UserFacts) => boolean): number => scanned.filter((u) => pred(u.facts)).length;
    const funnel: FunnelStage[] = [
      { key: "discover", label: "Discover", users: cnt((f) => f.sessions > 0) },
      { key: "activate", label: "Activate", users: cnt((f) => f.valueEvents >= 1) },
      { key: "habituate", label: "Habituate", users: cnt((f) => f.activeDays >= 3) },
      { key: "value", label: "Value", users: cnt((f) => f.valueEvents >= 4 && f.distinctSurfaces >= 2) },
      { key: "retain", label: "Retain", users: cnt((f) => f.activeDays >= 12) },
    ];

    const featureScorecard = computeScorecard(scanned.map((u) => u.facts));

    // Top-N power users (identity joined later on the web).
    const topUsers: UserProfileRow[] = scanned
      .map((u) => ({
        sourceUserId: u.uid,
        score: u.score,
        tier: u.tier,
        segment: u.segment,
        valueEvents: u.facts.valueEvents,
        actionEvents: u.facts.actionEvents,
        activeDays: u.facts.activeDays,
        distinctSurfaces: u.facts.distinctSurfaces,
        sessions: u.facts.sessions,
        lastActive: u.lastActive,
        username: null,
        discordUsername: null,
        role: null,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_USERS_LIMIT);

    // Weekly retention cohorts (windowed: cohort = a user's first active week in
    // the trailing 8 weeks; retention[w] = % of the cohort active in week cw+w).
    const nowWeek = Math.floor(asOf / WEEK);
    const retFrom = (nowWeek - (RETENTION_WEEKS - 1)) * WEEK;
    const retR = await db.execute(sql`
      SELECT source_user_id AS uid, FLOOR(occurred_at_utc / ${WEEK}) AS wk
      FROM analytics_events
      WHERE is_test = 0 AND occurred_at_utc >= ${retFrom}
      GROUP BY source_user_id, FLOOR(occurred_at_utc / ${WEEK})
      LIMIT ${USER_SCAN_CAP}`);
    const weeksByUser = new Map<number, Set<number>>();
    for (const row of rowsOf(retR)) {
      const uid = toNum(row.uid);
      const wk = toNum(row.wk);
      const s = weeksByUser.get(uid) ?? new Set<number>();
      s.add(wk);
      weeksByUser.set(uid, s);
    }
    const cohortUsers = new Map<number, number[]>();
    Array.from(weeksByUser.entries()).forEach(([uid, weeks]) => {
      const first = Math.min(...Array.from(weeks));
      const arr = cohortUsers.get(first) ?? [];
      arr.push(uid);
      cohortUsers.set(first, arr);
    });
    const retention: RetentionCohort[] = Array.from(cohortUsers.keys())
      .sort((a, b) => b - a)
      .map((cw) => {
        const uids = cohortUsers.get(cw) ?? [];
        const row: Array<number | null> = [];
        for (let w = 0; w < RETENTION_WEEKS; w++) {
          if (cw + w > nowWeek) {
            row.push(null);
          } else {
            const active = uids.filter((uid) => weeksByUser.get(uid)?.has(cw + w)).length;
            row.push(uids.length ? Math.round((active / uids.length) * 100) : 0);
          }
        }
        return { cohortWeek: new Date(cw * WEEK).toISOString().slice(0, 10), size: uids.length, retention: row };
      });

    // Daily activity trend (30-day window) — continuous + zero-filled so the
    // chart reads as a real timeline. A zero-day is a MEASURED zero (pipeline is
    // on), never a fabricated one.
    const dailyR = await db.execute(sql`
      SELECT FLOOR(occurred_at_utc / ${DAY}) AS day_idx,
             COUNT(DISTINCT source_user_id) AS users,
             SUM(CASE WHEN event_name IN (${nameList}) THEN 1 ELSE 0 END) AS value_events
      FROM analytics_events
      WHERE is_test = 0 AND occurred_at_utc >= ${monthFrom} AND occurred_at_utc < ${asOf}
      GROUP BY FLOOR(occurred_at_utc / ${DAY})`);
    const byDay = new Map<number, { users: number; valueEvents: number }>();
    for (const r of rowsOf(dailyR)) {
      byDay.set(toNum(r.day_idx), { users: toNum(r.users), valueEvents: toNum(r.value_events) });
    }
    const startDayIdx = Math.floor(monthFrom / DAY);
    const endDayIdx = Math.floor((asOf - 1) / DAY);
    const dailyActivity: DailyPoint[] = [];
    for (let d = startDayIdx; d <= endDayIdx; d++) {
      const hit = byDay.get(d);
      dailyActivity.push({
        day: new Date(d * DAY).toISOString().slice(0, 10),
        activeUsers: hit?.users ?? 0,
        valueEvents: hit?.valueEvents ?? 0,
      });
    }

    // No events at all ⇒ honest not_measured (nothing instrumented yet).
    if (lastEventAt === null && total === 0) return disabledOverview(NO_DATA);

    return {
      state: "ok",
      reason: null,
      asOf,
      dau: ok(dauN),
      wau: ok(wauN),
      mau: ok(mauN),
      valueEventsTotal: ok(total),
      totalActions: ok(totalActionsN),
      uniqueActions: ok(uniqueActionsN),
      topActions,
      topUsers,
      segments,
      funnel,
      featureScorecard,
      retention,
      dailyActivity,
      lastEventAt,
      deviceMix,
    };
  } catch (err) {
    console.warn(`${TAG} overview failed: ${(err as Error).message}`);
    return { ...disabledOverview("analytics overview query failed"), state: "error" };
  }
}
