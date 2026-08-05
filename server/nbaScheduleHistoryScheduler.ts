/**
 * nbaScheduleHistoryScheduler.ts
 *
 * Scheduler for NBA schedule history refresh.
 * Fetches from Action Network DK NJ API (book_id=68) and upserts into nba_schedule_history.
 *
 * Schedule:
 *   - Startup: immediate 7-day backfill (non-blocking)
 *   - Recurring: every 4 hours starting at 6 AM EST (6, 10, 2, 6, 10)
 *   - Each refresh: today + yesterday (to catch late-finishing games)
 *
 * Logging: [NbaScheduleHistoryScheduler][STEP/OUTPUT/VERIFY/ERROR] fully traceable
 */

import {
  refreshNbaScheduleForDate,
  backfillNbaScheduleHistory,
} from "./nbaScheduleHistoryService";

const TAG = "[NbaScheduleHistoryScheduler]";

// ─── Date Helpers ─────────────────────────────────────────────────────────────

/** Returns today's date in YYYYMMDD format (EST timezone) */
function todayEstAnDate(): string {
  const now = new Date();
  const estOffset = -5 * 60 * 60 * 1000;
  const est = new Date(now.getTime() + estOffset);
  return est.toISOString().slice(0, 10).replace(/-/g, "");
}

/** Returns yesterday's date in YYYYMMDD format (EST timezone) */
function yesterdayEstAnDate(): string {
  const now = new Date();
  const estOffset = -5 * 60 * 60 * 1000;
  const est = new Date(now.getTime() + estOffset - 24 * 60 * 60 * 1000);
  return est.toISOString().slice(0, 10).replace(/-/g, "");
}

/** Returns the current hour in EST (0–23) */
function currentHourEst(): number {
  const now = new Date();
  const estOffset = -5 * 60 * 60 * 1000;
  const est = new Date(now.getTime() + estOffset);
  return est.getHours();
}

/** Milliseconds until the next occurrence of a given EST hour */
function msUntilNextEstHour(targetHour: number): number {
  const now = new Date();
  const estOffset = -5 * 60 * 60 * 1000;
  const estNow = new Date(now.getTime() + estOffset);
  const next = new Date(estNow);
  next.setHours(targetHour, 0, 0, 0);
  if (next <= estNow) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() - estOffset - now.getTime();
}

// ─── Core Refresh Logic ───────────────────────────────────────────────────────

async function runDailyRefresh(): Promise<void> {
  const today = todayEstAnDate();
  const yesterday = yesterdayEstAnDate();
  console.log(
    `${TAG}[STEP] Daily refresh starting — today=${today} yesterday=${yesterday}`
  );

  // Refresh today
  try {
    const todayResult = await refreshNbaScheduleForDate(today);
    console.log(
      `${TAG}[OUTPUT] Today (${today}):` +
        ` fetched=${todayResult.fetched}` +
        ` upserted=${todayResult.upserted}` +
        ` errors=${todayResult.errors.length}`
    );
    if (todayResult.errors.length > 0) {
      console.warn(
        `${TAG}[WARN] Today errors:`,
        todayResult.errors.slice(0, 3)
      );
    }
  } catch (err) {
    console.error(`${TAG}[ERROR] Failed to refresh today (${today}):`, err);
  }

  // Refresh yesterday (catch late-finishing games and final scores)
  try {
    const yestResult = await refreshNbaScheduleForDate(yesterday);
    console.log(
      `${TAG}[OUTPUT] Yesterday (${yesterday}):` +
        ` fetched=${yestResult.fetched}` +
        ` upserted=${yestResult.upserted}` +
        ` errors=${yestResult.errors.length}`
    );
    if (yestResult.errors.length > 0) {
      console.warn(
        `${TAG}[WARN] Yesterday errors:`,
        yestResult.errors.slice(0, 3)
      );
    }
  } catch (err) {
    console.error(
      `${TAG}[ERROR] Failed to refresh yesterday (${yesterday}):`,
      err
    );
  }

  console.log(`${TAG}[VERIFY] Daily refresh complete`);
}

// ─── Startup Backfill ─────────────────────────────────────────────────────────

async function runStartupBackfill(): Promise<void> {
  console.log(`${TAG}[STEP] Startup backfill — last 7 days from AN DK NJ API`);
  try {
    const results = await backfillNbaScheduleHistory(7);
    const totalFetched = results.reduce((s, r) => s + r.fetched, 0);
    const totalUpserted = results.reduce((s, r) => s + r.upserted, 0);
    const totalErrors = results.reduce((s, r) => s + r.errors.length, 0);
    console.log(
      `${TAG}[OUTPUT] Startup backfill complete:` +
        ` dates=${results.length}` +
        ` totalFetched=${totalFetched}` +
        ` totalUpserted=${totalUpserted}` +
        ` totalErrors=${totalErrors}`
    );
    if (totalErrors > 0) {
      console.warn(
        `${TAG}[WARN] Backfill had ${totalErrors} errors — check logs above`
      );
    }
  } catch (err) {
    console.error(`${TAG}[ERROR] Startup backfill failed (non-fatal):`, err);
  }
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

export function startNbaScheduleHistoryScheduler(): void {
  console.log(`${TAG}[STEP] Initializing NBA schedule history scheduler`);

  // 1. Startup backfill — runs immediately, non-blocking
  setImmediate(async () => {
    await runStartupBackfill();
  });

  // 2. Schedule recurring refresh every 4 hours starting at 6 AM EST
  const INTERVAL_MS = 4 * 60 * 60 * 1000;
  const msToFirst6am = msUntilNextEstHour(6);
  const nextRun = new Date(Date.now() + msToFirst6am);

  console.log(
    `${TAG}[STEP] First scheduled refresh at ${nextRun.toISOString()}` +
      ` (in ${Math.round(msToFirst6am / 1000 / 60)} min)` +
      ` — then every 4 hours`
  );

  setTimeout(async () => {
    const hourEst = currentHourEst();
    console.log(
      `${TAG}[STEP] Scheduled refresh triggered at EST hour=${hourEst}`
    );
    await runDailyRefresh();

    setInterval(async () => {
      const h = currentHourEst();
      if (h >= 6) {
        console.log(`${TAG}[STEP] Interval refresh triggered at EST hour=${h}`);
        await runDailyRefresh();
      } else {
        console.log(
          `${TAG}[STEP] Interval tick skipped — EST hour=${h} (outside 6AM–midnight window)`
        );
      }
    }, INTERVAL_MS);
  }, msToFirst6am);
}
