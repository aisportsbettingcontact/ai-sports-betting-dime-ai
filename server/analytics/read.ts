/**
 * read.ts — device-aware admin overview from the DEDICATED MySQL: Dime AI.
 * Store-role only (guard()); never touches TiDB. Read failures degrade to an
 * honest not_measured payload — never throws to the product. Aggregates only
 * (counts / distinct users / device buckets) — no per-user rows, no PII.
 */
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { isAnalyticsStore } from "./config";
import { QUALIFYING_EVENTS } from "./events";
import { ok, notMeasured, type MetricPoint } from "./metricDefinitions";

const TAG = "[analytics][read]";
const DAY = 24 * 60 * 60 * 1000;

export interface DeviceSlice {
  deviceType: string;
  users: number;
  valueEvents: number;
}

export interface AnalyticsOverview {
  state: "ok" | "not_measured" | "error";
  reason: string | null;
  asOf: number;
  dau: MetricPoint;
  wau: MetricPoint;
  mau: MetricPoint;
  valueEventsTotal: MetricPoint;
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
    lastEventAt: null,
    deviceMix: [],
  };
}

/** Extract a single scalar column from a mysql2/drizzle result across shapes. */
function numAt(result: unknown, key = "n"): number {
  const arr = Array.isArray(result) ? result : (result as { rows?: unknown[] })?.rows;
  const first = Array.isArray(arr) ? (arr[0] as Record<string, unknown>) : undefined;
  const v = first?.[key];
  return typeof v === "number" ? v : Number(v ?? 0) || 0;
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
             SUM(CASE WHEN event_name IN (${nameList}) THEN 1 ELSE 0 END) AS value_events
      FROM analytics_events WHERE is_test = 0
      GROUP BY COALESCE(device_type, 'unknown')`);
    const mixRows = (Array.isArray(mixR)
      ? mixR
      : (mixR as { rows?: unknown[] })?.rows ?? []) as Array<Record<string, unknown>>;
    const deviceMix: DeviceSlice[] = mixRows.map((r) => ({
      deviceType: String(r.device_type ?? "unknown"),
      users: Number(r.users ?? 0) || 0,
      valueEvents: Number(r.value_events ?? 0) || 0,
    }));

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
      lastEventAt,
      deviceMix,
    };
  } catch (err) {
    console.warn(`${TAG} overview failed: ${(err as Error).message}`);
    return { ...disabledOverview("analytics overview query failed"), state: "error" };
  }
}
