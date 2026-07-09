/**
 * mlbScheduleHistoryScheduler.ts
 *
 * Schedules daily automatic refresh of the mlb_schedule_history table.
 *
 * ─── Season Boundaries (exact, per Baseball Reference) ───────────────────────
 *   2023: Opening Day 2023-03-30 | Postseason end 2023-11-01
 *   2024: Opening Day 2024-03-20 | Postseason end 2024-10-30
 *   2025: Opening Day 2025-03-18 | Postseason end 2025-11-01
 *   2026: Opening Day 2026-03-25 | Postseason end TBD (ongoing)
 *
 * ─── Data Source ─────────────────────────────────────────────────────────────
 *   Action Network v1 API (/web/v1/scoreboard/mlb)
 *   DraftKings NJ (book_id=68) exclusively
 *   Fields: spread_away, spread_home, spread_away_line, spread_home_line,
 *           ml_away, ml_home, total, over, under
 *
 * ─── Schedule ────────────────────────────────────────────────────────────────
 *   Startup:  Backfill last 60 days (catches any missed data from gaps)
 *   Recurring: Every 4 hours from 6:00 AM to 11:59 PM EST
 *             (6 AM, 10 AM, 2 PM, 6 PM, 10 PM)
 *   Each run: Refreshes today + yesterday (captures pre-game odds + final scores)
 *
 * Logging: [MlbScheduleScheduler][STEP/OUTPUT/VERIFY] fully traceable
 */

import {
  refreshMlbScheduleForDate,
  refreshMlbScheduleLastNDays,
  captureClosingLines,
} from "./mlbScheduleHistoryService";
import { logToDb } from "./dbLogger";

const TAG = "[MlbScheduleScheduler]";
const SRC = "MlbScheduleHistory";

// ─── Season Boundary Constants ────────────────────────────────────────────────

/** All known MLB season boundaries. Used for validation and logging. */
export const MLB_SEASON_BOUNDARIES = [
  { season: 2023, openingDay: "2023-03-30", postseasonEnd: "2023-11-01" },
  { season: 2024, openingDay: "2024-03-20", postseasonEnd: "2024-10-30" },
  { season: 2025, openingDay: "2025-03-18", postseasonEnd: "2025-11-01" },
  { season: 2026, openingDay: "2026-03-25", postseasonEnd: null }, // ongoing
] as const;

// ─── Date Helpers ─────────────────────────────────────────────────────────────

/** Format a Date as YYYYMMDD for the AN API */
function toAnDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/** Get today's date in EST as YYYYMMDD */
function todayEstAnDate(): string {
  const now = new Date();
  // Use UTC-5 (EST) consistently — DST is not applied to avoid drift
  const estOffset = -5 * 60 * 60 * 1000;
  const est = new Date(now.getTime() + estOffset);
  return toAnDate(est);
}

/** Get yesterday's date in EST as YYYYMMDD */
function yesterdayEstAnDate(): string {
  const now = new Date();
  const estOffset = -5 * 60 * 60 * 1000;
  const est = new Date(now.getTime() + estOffset - 24 * 60 * 60 * 1000);
  return toAnDate(est);
}

/** Current hour in EST (0–23) */
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
  // Convert back to UTC ms
  return next.getTime() - estOffset - now.getTime();
}

// ─── Core Refresh Logic ───────────────────────────────────────────────────────

/**
 * Refresh today's and yesterday's MLB schedule data from AN DK NJ API.
 * Called on every scheduled tick.
 */
async function runDailyRefresh(): Promise<void> {
  const today = todayEstAnDate();
  const yesterday = yesterdayEstAnDate();

  logToDb(SRC, 'info', `${TAG}[STEP] Daily refresh starting — today=${today} yesterday=${yesterday}`);

  // Refresh today
  try {
    const todayResult = await refreshMlbScheduleForDate(today);
    logToDb(SRC, 'info',
      `${TAG}[OUTPUT] Today (${today}):` +
      ` fetched=${todayResult.fetched}` +
      ` upserted=${todayResult.upserted}` +
      ` errors=${todayResult.errors.length}`
    );
    if (todayResult.errors.length > 0) {
      logToDb(SRC, 'warn', `${TAG}[WARN] Today errors: ${todayResult.errors.slice(0, 3).join('; ')}`);
    }
  } catch (err) {
    logToDb(SRC, 'error', `${TAG}[ERROR] Failed to refresh today (${today}): ${err}`);
  }

  // Refresh yesterday (catch late-finishing games and final scores)
  try {
    const yestResult = await refreshMlbScheduleForDate(yesterday);
    logToDb(SRC, 'info',
      `${TAG}[OUTPUT] Yesterday (${yesterday}):` +
      ` fetched=${yestResult.fetched}` +
      ` upserted=${yestResult.upserted}` +
      ` errors=${yestResult.errors.length}`
    );
    if (yestResult.errors.length > 0) {
      logToDb(SRC, 'warn', `${TAG}[WARN] Yesterday errors: ${yestResult.errors.slice(0, 3).join('; ')}`);
    }
  } catch (err) {
    logToDb(SRC, 'error', `${TAG}[ERROR] Failed to refresh yesterday (${yesterday}): ${err}`);
  }

  logToDb(SRC, 'info', `${TAG}[VERIFY] Daily refresh complete — today=${today} yesterday=${yesterday}`);
}

// ─── Startup Backfill ─────────────────────────────────────────────────────────

/**
 * On server startup, backfill the last 60 days to ensure the DB is fully
 * populated with recent data. This catches any gaps from server downtime,
 * SSL errors, or missed refreshes.
 *
 * Season boundaries are logged for traceability.
 * Runs once immediately, non-blocking.
 */
async function runStartupBackfill(): Promise<void> {
  logToDb(SRC, 'info', `${TAG}[STEP] Startup backfill — last 60 days from AN DK NJ v1 API`);
  const boundaryLines = MLB_SEASON_BOUNDARIES.map(s => `${s.season}: ${s.openingDay} → ${s.postseasonEnd ?? 'ongoing'}`).join(' | ');
  logToDb(SRC, 'info', `${TAG}[INPUT] Season boundaries: ${boundaryLines}`);

  try {
    const results = await refreshMlbScheduleLastNDays(60);
    const totalFetched  = results.reduce((sum, r) => sum + r.fetched,  0);
    const totalUpserted = results.reduce((sum, r) => sum + r.upserted, 0);
    const totalErrors   = results.reduce((sum, r) => sum + r.errors.length, 0);

    logToDb(SRC, 'info',
      `${TAG}[OUTPUT] Startup backfill complete:` +
      ` dates=${results.length}` +
      ` totalFetched=${totalFetched}` +
      ` totalUpserted=${totalUpserted}` +
      ` totalErrors=${totalErrors}`
    );

    if (totalErrors > 0) {
      logToDb(SRC, 'warn', `${TAG}[WARN] Backfill had ${totalErrors} errors — check debug_logs table`);
    } else {
      logToDb(SRC, 'info', `${TAG}[VERIFY] PASS — startup backfill completed with 0 errors`);
    }
  } catch (err) {
    logToDb(SRC, 'error', `${TAG}[ERROR] Startup backfill failed (non-fatal): ${err}`);
  }

  // After the 60-day backfill, immediately run a daily refresh for today + yesterday.
  // This ensures game scores and statuses are current regardless of when the server
  // was restarted relative to the 4-hour scheduled refresh window.
  logToDb(SRC, 'info', `${TAG}[STEP] Post-startup daily refresh — today + yesterday`);
  try {
    await runDailyRefresh();
    logToDb(SRC, 'info', `${TAG}[VERIFY] PASS — post-startup daily refresh complete`);
  } catch (err) {
    logToDb(SRC, 'error', `${TAG}[ERROR] Post-startup daily refresh failed (non-fatal): ${err}`);
  }
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

/**
 * Start the MLB schedule history refresh scheduler.
 *
 * Behavior:
 *   1. Immediately runs a 60-day backfill (non-blocking)
 *   2. Schedules a refresh every 4 hours starting at 6:00 AM EST
 *      (6 AM, 10 AM, 2 PM, 6 PM, 10 PM)
 *   3. Each refresh updates today + yesterday
 *
 * Data source: Action Network v1 API, DK NJ (book_id=68) exclusively
 */
export function startMlbScheduleHistoryScheduler(): void {
  console.log(`${TAG}[STEP] Initializing MLB schedule history scheduler`);
  console.log(`${TAG}[INPUT] Data source: Action Network v1 API, DK NJ book_id=68`);

  // 1. Startup backfill — runs immediately, non-blocking
  setImmediate(async () => {
    await runStartupBackfill();
  });

  // 2. Schedule recurring refresh every 4 hours starting at 6 AM EST
  const INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
  const msToFirst6am = msUntilNextEstHour(6);
  const nextRun = new Date(Date.now() + msToFirst6am);

  console.log(
    `${TAG}[STEP] First scheduled refresh at ${nextRun.toISOString()}` +
    ` (in ${Math.round(msToFirst6am / 1000 / 60)} min)` +
    ` — then every 4 hours`
  );

  setTimeout(async () => {
    // First run at 6 AM EST
    const hourEst = currentHourEst();
    logToDb(SRC, 'info', `${TAG}[STEP] Scheduled refresh triggered at EST hour=${hourEst}`);
    await runDailyRefresh();

    // Repeat every 4 hours
    setInterval(async () => {
      const h = currentHourEst();
      // Only run between 6 AM and 11:59 PM EST (skip overnight hours 0–5)
      if (h >= 6) {
        logToDb(SRC, 'info', `${TAG}[STEP] Interval refresh triggered at EST hour=${h}`);
        await runDailyRefresh();
      } else {
        logToDb(SRC, 'info', `${TAG}[STEP] Interval tick skipped — EST hour=${h} (outside 6AM–midnight window)`);
      }
    }, INTERVAL_MS);
  }, msToFirst6am);

  // ─── Closing Line Capture — every 5 minutes during game hours ─────────────
  // Fires every 5 minutes from 10 AM to 2 AM EST (covers all MLB game windows).
  // Locks closing lines the moment a game transitions to "inprogress" (first pitch).
  // Idempotent — already-locked games are skipped instantly.
  const CLOSING_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

  console.log(
    `${TAG}[STEP] Closing line capture scheduled — every 5 min during 10AM–2AM EST`
  );

  setInterval(async () => {
    const h = currentHourEst();
    // Run from 10 AM to 2 AM EST (h >= 10 OR h < 2)
    const inGameWindow = h >= 10 || h < 2;
    if (!inGameWindow) {
      // Silent skip — no log noise during off-hours
      return;
    }
    logToDb(SRC, 'info', `${TAG}[MlbClosingLine][STEP] 5-min tick — EST hour=${h} — running captureClosingLines`);
    try {
      const result = await captureClosingLines();
      if (result.locked > 0) {
        logToDb(SRC, 'info',
          `${TAG}[MlbClosingLine][OUTPUT] Locked ${result.locked} closing lines` +
          ` | alreadyLocked=${result.alreadyLocked} noOdds=${result.noOdds} errors=${result.errors.length}`
        );
      }
      if (result.errors.length > 0) {
        logToDb(SRC, 'warn',
          `${TAG}[MlbClosingLine][WARN] ${result.errors.length} errors during capture: ${result.errors.slice(0, 3).join('; ')}`
        );
      }
    } catch (err) {
      logToDb(SRC, 'error', `${TAG}[MlbClosingLine][ERROR] captureClosingLines threw: ${err}`);
    }
  }, CLOSING_INTERVAL_MS);
}
