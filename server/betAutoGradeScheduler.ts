/**
 * betAutoGradeScheduler.ts — Automated bet grading background scheduler.
 *
 * Strategy: three-layer approach for maximum coverage:
 *
 *   Layer 1 — Live polling (every 5 minutes) during prime game hours:
 *     Active window: 6:00 PM – 2:00 AM PST (peak MLB/NHL/NBA/NCAAM live game window)
 *     Grades all PENDING bets for today + yesterday with near-real-time settlement
 *
 *   Layer 2 — Standard polling (every 15 minutes) during full game hours:
 *     Active window: 7:00 AM – 11:59 PM PST (covers all daytime games)
 *     Grades all PENDING bets for today + yesterday
 *
 *   Layer 3 — Nightly sweep at 11:59 PM PST (HARDCODED):
 *     Fires at exactly 23:59 PST = 07:59 UTC (PST = UTC-8, PDT = UTC-7 handled via Intl)
 *     Grades ALL PENDING bets across ALL dates (catches any missed bets)
 *     Runs regardless of game hours — always fires at 11:59 PM PST
 *
 * Critical fixes (v2):
 *   - customLine is now passed to gradeTrackedBet (was using raw line only — WRONG for custom lines)
 *   - gameNumber is now passed to gradeTrackedBet (was missing — WRONG for doubleheader G2 bets)
 *   - invalidateStatsCacheForUser is called after each batch grade (stats cache was stale after background grading)
 *   - Live polling interval: 5 min during 6 PM–2 AM PST (was 15 min — too slow for real-time settlement)
 *
 * Logging convention:
 *   [BetAutoGrade][INPUT]  — scheduler trigger + context
 *   [BetAutoGrade][STEP]   — operation in progress
 *   [BetAutoGrade][STATE]  — intermediate values
 *   [BetAutoGrade][OUTPUT] — grading result
 *   [BetAutoGrade][VERIFY] — validation pass/fail
 *   [BetAutoGrade][ERROR]  — failure with context
 */

import { getDb } from "./db";
import { trackedBets, type TrackedBet } from "../drizzle/schema";
import { eq, and, sql } from "drizzle-orm";
import {
  gradeTrackedBet,
  fetchScores,
  type Sport as GraderSport,
  type Timeframe as GraderTimeframe,
  type Market as GraderMarket,
  type PickSide as GraderPickSide,
} from "./scoreGrader";
import { invalidateStatsCacheForUser } from "./betTrackerStatsCache";
import { effectiveLine } from "./betTrackerCore";
import {
  describeGradingErrors,
  describeNoMatch,
  describeStuckBets,
  gradingAlert,
  STUCK_THRESHOLD_HOURS,
  type StuckBet,
} from "./betGradingHealth";

// ─── PST/PDT helpers ─────────────────────────────────────────────────────────

/** Get current time in PST/PDT as { hour, minute, dateStr } */
function nowPst(): { hour: number; minute: number; dateStr: string } {
  const now = new Date();
  // PST = UTC-8, PDT = UTC-7; use Intl to handle DST automatically
  const pstStr = now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
  const pst = new Date(pstStr);
  const hour   = pst.getHours();
  const minute = pst.getMinutes();
  // Date string YYYY-MM-DD in PST/PDT
  const y = pst.getFullYear();
  const m = String(pst.getMonth() + 1).padStart(2, "0");
  const d = String(pst.getDate()).padStart(2, "0");
  return { hour, minute, dateStr: `${y}-${m}-${d}` };
}

/** Get yesterday's date string in PST/PDT (YYYY-MM-DD) */
function yesterdayPst(): string {
  const now = new Date();
  const pstStr = now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
  const pst = new Date(pstStr);
  pst.setDate(pst.getDate() - 1);
  const y = pst.getFullYear();
  const m = String(pst.getMonth() + 1).padStart(2, "0");
  const d = String(pst.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ─── Core grading engine ──────────────────────────────────────────────────────

export interface GradeSummary {
  date: string;
  total: number;
  graded: number;
  wins: number;
  losses: number;
  pushes: number;
  voids: number;
  stillPending: number;
  errors: number;
  details: Array<{ betId: number; result: string; reason: string }>;
}

function emptySummary(date: string): GradeSummary {
  return { date, total: 0, graded: 0, wins: 0, losses: 0, pushes: 0, voids: 0, stillPending: 0, errors: 0, details: [] };
}

/**
 * THE grading implementation. Every path that settles a bet goes through here:
 * the in-process scheduler, the /api/cron/bet-grade endpoint, and the
 * betTracker.autoGrade / autoGradeAll tRPC procedures.
 *
 * Previously the router carried its own near-copy of this loop, and the two had
 * already drifted (create's copy overwrote team abbreviations whenever they
 * differed; the router's copy only filled blanks). One implementation removes
 * the class of bug entirely.
 *
 * Behaviour:
 *   - customLine wins over line (an explicit user override beats the book line)
 *   - gameNumber is passed through so doubleheader G2 resolves to the right game
 *   - Blank/"OPP" team names self-heal from the official feed's abbreviations
 *   - VOID (postponed/cancelled) is persisted like any other terminal result
 *   - Stats caches are invalidated for the OWNER of each graded bet
 */
async function gradePendingRows(rows: TrackedBet[], date: string, trigger: string): Promise<GradeSummary> {
  if (rows.length === 0) return emptySummary(date);

  const db = await getDb();

  // Warm the score cache once per sport so the per-bet loop is pure CPU + DB.
  const sportsNeeded = Array.from(new Set(rows.map(b => b.sport))) as GraderSport[];
  const datesNeeded = Array.from(new Set(rows.map(b => b.gameDate)));
  await Promise.all(
    sportsNeeded.flatMap(s =>
      datesNeeded.map(d =>
        fetchScores(s, d).catch(err => {
          console.log(`[BetAutoGrade][ERROR] score pre-fetch failed: sport=${s} date=${d} err=${(err as Error).message}`);
        })
      )
    )
  );

  const summary = emptySummary(date);
  summary.total = rows.length;
  const gradedUserIds = new Set<number>();

  for (const bet of rows) {
    try {
      const gradeLineValue = effectiveLine(bet.line, bet.customLine);

      const gradeOut = await gradeTrackedBet({
        sport:      bet.sport as GraderSport,
        gameDate:   bet.gameDate,
        awayTeam:   bet.awayTeam ?? "",
        homeTeam:   bet.homeTeam ?? "",
        timeframe:  (bet.timeframe ?? "FULL_GAME") as GraderTimeframe,
        market:     (bet.market ?? "ML") as GraderMarket,
        pickSide:   (bet.pickSide ?? "AWAY") as GraderPickSide,
        odds:       bet.odds,
        line:       gradeLineValue,
        anGameId:   bet.anGameId,
        gameNumber: (bet.gameNumber ?? 1) as 1 | 2,
      });

      summary.details.push({ betId: bet.id, result: gradeOut.result, reason: gradeOut.reason });

      if (gradeOut.result === "PENDING" || gradeOut.result === "NO_RESULT") {
        summary.stillPending++;
        continue;
      }

      const updatePayload: Record<string, string | null> = {
        result:    gradeOut.result,
        awayScore: gradeOut.awayScore !== null ? String(gradeOut.awayScore) : null,
        homeScore: gradeOut.homeScore !== null ? String(gradeOut.homeScore) : null,
      };
      // Self-heal blank/placeholder team names from the official feed.
      const awayBlank = !bet.awayTeam || bet.awayTeam === "OPP" || bet.awayTeam.trim() === "";
      const homeBlank = !bet.homeTeam || bet.homeTeam === "OPP" || bet.homeTeam.trim() === "";
      if (gradeOut.awayAbbrev && awayBlank) updatePayload.awayTeam = gradeOut.awayAbbrev;
      if (gradeOut.homeAbbrev && homeBlank) updatePayload.homeTeam = gradeOut.homeAbbrev;

      await db.update(trackedBets).set(updatePayload).where(eq(trackedBets.id, bet.id));
      gradedUserIds.add(bet.userId);

      summary.graded++;
      if (gradeOut.result === "WIN")  summary.wins++;
      if (gradeOut.result === "LOSS") summary.losses++;
      if (gradeOut.result === "PUSH") summary.pushes++;
      if (gradeOut.result === "VOID") summary.voids++;

      console.log(`[BetAutoGrade][OUTPUT] betId=${bet.id} userId=${bet.userId} ${bet.awayTeam}@${bet.homeTeam} → ${gradeOut.result} | ${gradeOut.reason}`);
    } catch (err) {
      summary.errors++;
      summary.details.push({ betId: bet.id, result: "ERROR", reason: (err as Error).message });
      console.log(`[BetAutoGrade][ERROR] betId=${bet.id} grading failed: ${(err as Error).message}`);
    }
  }

  for (const uid of Array.from(gradedUserIds)) invalidateStatsCacheForUser(uid);

  // Health signals. Never allowed to affect the grading outcome — a broken
  // webhook must not break settlement, so both are fire-and-forget.
  const errMsg = describeGradingErrors(summary);
  if (errMsg) void gradingAlert("GRADING_ERRORS", errMsg);
  const noMatchMsg = describeNoMatch(summary.details);
  if (noMatchMsg) void gradingAlert("NO_MATCH", noMatchMsg);

  console.log(
    `[BetAutoGrade][OUTPUT] gradePendingRows: trigger=${trigger} scope=${date} total=${summary.total} ` +
    `graded=${summary.graded} W=${summary.wins} L=${summary.losses} P=${summary.pushes} V=${summary.voids} ` +
    `stillPending=${summary.stillPending} errors=${summary.errors}`
  );
  return summary;
}

/** Grade all PENDING bets for a specific date, across every user. */
async function gradeAllPendingForDate(date: string, trigger: string): Promise<GradeSummary> {
  const db = await getDb();
  const pending = await db.select().from(trackedBets).where(
    and(eq(trackedBets.result, "PENDING"), eq(trackedBets.gameDate, date))
  );
  if (pending.length === 0) {
    console.log(`[BetAutoGrade][STATE] gradeAllPendingForDate: 0 PENDING bets for date=${date} — skipping`);
    return emptySummary(date);
  }
  console.log(`[BetAutoGrade][INPUT] gradeAllPendingForDate: date=${date} trigger=${trigger} pending=${pending.length}`);
  return gradePendingRows(pending as TrackedBet[], date, trigger);
}

/**
 * Grade one user's PENDING bets, optionally narrowed to a sport and/or date.
 * Backs the betTracker.autoGrade procedure so the interactive path and the
 * background path cannot diverge.
 */
export async function gradePendingForUser(
  userId: number,
  filter: { sport?: string; gameDate?: string },
  trigger: string,
): Promise<GradeSummary> {
  const db = await getDb();
  const conditions = [eq(trackedBets.userId, userId), eq(trackedBets.result, "PENDING")];
  if (filter.sport) conditions.push(eq(trackedBets.sport, filter.sport as TrackedBet["sport"]));
  if (filter.gameDate) conditions.push(eq(trackedBets.gameDate, filter.gameDate));

  const pending = await db.select().from(trackedBets).where(and(...conditions));
  const scope = filter.gameDate ?? "ALL";
  if (pending.length === 0) return emptySummary(scope);
  console.log(`[BetAutoGrade][INPUT] gradePendingForUser: userId=${userId} trigger=${trigger} pending=${pending.length}`);
  return gradePendingRows(pending as TrackedBet[], scope, trigger);
}

/**
 * Grade ALL PENDING bets across ALL dates (nightly sweep).
 * Used for the 11:59 PM PST nightly job to catch any missed bets.
 */
async function gradeAllPendingAllDates(trigger: string): Promise<void> {
  console.log(`[BetAutoGrade][INPUT] gradeAllPendingAllDates: trigger=${trigger}`);

  const db = await getDb();

  // Fetch all PENDING bets regardless of date
  const pending = await db.select().from(trackedBets).where(eq(trackedBets.result, "PENDING"));

  if (pending.length === 0) {
    console.log(`[BetAutoGrade][STATE] gradeAllPendingAllDates: 0 PENDING bets — nothing to grade`);
    return;
  }

  // Group by date for efficient score fetching
  const byDate = new Map<string, typeof pending>();
  for (const bet of pending as Array<typeof pending[0]>) {
    const arr = byDate.get(bet.gameDate) ?? [];
    arr.push(bet);
    byDate.set(bet.gameDate, arr);
  }

  const dates = Array.from(byDate.keys()).sort();
  console.log(`[BetAutoGrade][STATE] gradeAllPendingAllDates: ${pending.length} PENDING bets across ${dates.length} dates: [${dates.join(", ")}]`);

  let totalGraded = 0, totalStillPending = 0, totalErrors = 0;

  // Grade the rows we already hold, per date. Re-selecting per date (the old
  // shape) issued 1 + N queries for data this function had already fetched.
  for (const date of dates) {
    const summary = await gradePendingRows(byDate.get(date) as TrackedBet[], date, trigger);
    totalGraded       += summary.graded;
    totalStillPending += summary.stillPending;
    totalErrors       += summary.errors;
  }

  console.log(`[BetAutoGrade][OUTPUT] gradeAllPendingAllDates: COMPLETE — totalGraded=${totalGraded} totalStillPending=${totalStillPending} totalErrors=${totalErrors}`);
  console.log(`[BetAutoGrade][VERIFY] gradeAllPendingAllDates: ${totalErrors === 0 ? "PASS" : "WARN"} — ${totalErrors} errors across all dates`);
}

// ─── Scheduler state ──────────────────────────────────────────────────────────

let livePollingInterval:     ReturnType<typeof setInterval> | null = null; // 5-min live window
let standardPollingInterval: ReturnType<typeof setInterval> | null = null; // 15-min standard window
let nightlySweepInterval:    ReturnType<typeof setInterval> | null = null; // 1-min nightly check
/**
 * THE grading mutex for this process.
 *
 * Every path that settles bets in bulk must hold it: the in-process pollers, the
 * nightly sweep, AND the cron endpoints. The cron path used to bypass it —
 * `runBetGradeCycle` called `gradeAllPendingForDate` directly while
 * `CronJobRunner` held only its own independent lock — so a GitHub-triggered
 * grade and the 5-minute in-process poll could select the same PENDING rows and
 * grade them concurrently. Idempotent in outcome, but it doubled upstream score
 * fetches and interleaved writes on the same rows.
 */
let isGrading = false;

/** Run `work` under the grading mutex, or skip if a grade is already running. */
async function withGradingLock<T>(
  label: string,
  work: () => Promise<T>,
): Promise<T | { skipped: true }> {
  if (isGrading) {
    console.log(`[BetAutoGrade][STEP] ${label}: SKIP — grade already in progress`);
    return { skipped: true };
  }
  isGrading = true;
  try {
    return await work();
  } finally {
    isGrading = false;
  }
}
/** The night (PT date) whose sweep has already completed. Guards against re-running. */
let lastSweptNight: string | null = null;

/**
 * Which night's sweep is currently due, or null if none.
 *
 * Pure so it can be tested without a clock. The window deliberately spans
 * 23:57 PT through 00:30 PT the next morning: a 3-minute window with a
 * 1-minute tick meant a single slow polling run holding the mutex could consume
 * every attempt, and the sweep for that night was then lost silently. With a
 * ~33-minute window the sweep gets ~33 chances at the lock instead of 3, and
 * `lastSweptNight` still guarantees it runs at most once per night.
 */
export function nightlySweepTarget(now: {
  hour: number;
  minute: number;
  dateStr: string;
  yesterday: string;
}): string | null {
  if (now.hour === 23 && now.minute >= 57) return now.dateStr;
  if (now.hour === 0 && now.minute <= 30) return now.yesterday;
  return null;
}

// ─── Game hours checks ────────────────────────────────────────────────────────

/**
 * Returns true if within standard game hours (7 AM – 11:59 PM PST).
 * Covers all daytime MLB games through late-night NBA/NHL.
 */
function isWithinGameHours(): boolean {
  const { hour } = nowPst();
  return hour >= 7 && hour <= 23;
}

/**
 * Returns true if within the prime live game window (6 PM – 2 AM PST).
 * This is when the majority of MLB/NHL/NBA games are live.
 * We use a 5-minute polling interval during this window for near-real-time grading.
 * Note: 2 AM = hour 2, so we check hour >= 18 OR hour <= 2.
 */
function isWithinLiveGameWindow(): boolean {
  const { hour } = nowPst();
  return hour >= 18 || hour <= 2;
}

// ─── Live polling job (every 5 minutes during prime game hours) ───────────────

async function runLivePollingGrade(): Promise<void> {
  if (!isWithinLiveGameWindow()) return; // only fires during live game window
  if (isGrading) {
    console.log(`[BetAutoGrade][STEP] runLivePollingGrade: SKIP — grade already in progress`);
    return;
  }

  const { hour, dateStr } = nowPst();
  const yesterday = yesterdayPst();

  isGrading = true;
  console.log(`[BetAutoGrade][INPUT] runLivePollingGrade: TRIGGERED at PST hour=${hour} (live window) — grading today=${dateStr} + yesterday=${yesterday}`);

  try {
    const todaySummary     = await gradeAllPendingForDate(dateStr,   "live_polling");
    const yesterdaySummary = await gradeAllPendingForDate(yesterday, "live_polling_yesterday");
    const totalGraded  = todaySummary.graded  + yesterdaySummary.graded;
    const totalPending = todaySummary.stillPending + yesterdaySummary.stillPending;
    console.log(`[BetAutoGrade][OUTPUT] runLivePollingGrade: COMPLETE — today_graded=${todaySummary.graded} yesterday_graded=${yesterdaySummary.graded} totalGraded=${totalGraded} stillPending=${totalPending}`);
  } catch (err) {
    console.log(`[BetAutoGrade][ERROR] runLivePollingGrade: FAILED — ${(err as Error).message}`);
  } finally {
    isGrading = false;
  }
}

// ─── Standard polling job (every 15 minutes during game hours) ───────────────

async function runPollingGrade(): Promise<void> {
  // Skip during live window — live polling already handles it at 5-min cadence
  if (isWithinLiveGameWindow()) {
    console.log(`[BetAutoGrade][STEP] runPollingGrade: SKIP — live polling active (6PM–2AM PST)`);
    return;
  }
  if (!isWithinGameHours()) {
    const { hour } = nowPst();
    console.log(`[BetAutoGrade][STEP] runPollingGrade: SKIP — outside game hours (PST hour=${hour})`);
    return;
  }
  if (isGrading) {
    console.log(`[BetAutoGrade][STEP] runPollingGrade: SKIP — grade already in progress`);
    return;
  }

  const { hour, dateStr } = nowPst();
  const yesterday = yesterdayPst();

  isGrading = true;
  console.log(`[BetAutoGrade][INPUT] runPollingGrade: TRIGGERED at PST hour=${hour} — grading today=${dateStr} + yesterday=${yesterday}`);

  try {
    const todaySummary     = await gradeAllPendingForDate(dateStr,   "polling");
    const yesterdaySummary = await gradeAllPendingForDate(yesterday, "polling_yesterday");
    const totalGraded  = todaySummary.graded  + yesterdaySummary.graded;
    const totalPending = todaySummary.stillPending + yesterdaySummary.stillPending;
    console.log(`[BetAutoGrade][OUTPUT] runPollingGrade: COMPLETE — today_graded=${todaySummary.graded} yesterday_graded=${yesterdaySummary.graded} totalGraded=${totalGraded} stillPending=${totalPending}`);
  } catch (err) {
    console.log(`[BetAutoGrade][ERROR] runPollingGrade: FAILED — ${(err as Error).message}`);
  } finally {
    isGrading = false;
  }
}

// ─── Nightly sweep job (11:59 PM PST — HARDCODED) ───────────────────────────

async function runNightlySweep(): Promise<void> {
  const { hour, minute, dateStr } = nowPst();
  const target = nightlySweepTarget({ hour, minute, dateStr, yesterday: yesterdayPst() });

  if (target === null) return;
  if (lastSweptNight === target) return; // already swept this night

  if (isGrading) {
    // Not a skip-and-lose: the window stays open for ~33 minutes, so the next
    // 1-minute tick retries until the lock frees.
    console.log(`[BetAutoGrade][STEP] runNightlySweep: DEFERRED — grade in progress, retrying next tick (target night=${target})`);
    return;
  }

  isGrading = true;
  console.log(`[BetAutoGrade][INPUT] runNightlySweep: TRIGGERED for night=${target} — grading ALL PENDING bets across ALL dates`);

  try {
    await gradeAllPendingAllDates(`nightly_sweep_${target}`);
    lastSweptNight = target;
    console.log(`[BetAutoGrade][VERIFY] runNightlySweep: PASS — nightly sweep complete for night=${target}`);
  } catch (err) {
    // Leave lastSweptNight unset so the remaining window retries this night.
    console.log(`[BetAutoGrade][ERROR] runNightlySweep: FAILED — ${(err as Error).message}`);
  } finally {
    isGrading = false;
  }
}

// ─── Public: start the scheduler ─────────────────────────────────────────────

/**
 * Start the automated bet grading scheduler.
 * Called once on server startup.
 *
 * Schedules:
 *   - Every 5 minutes:  live polling during prime game hours (6 PM–2 AM PST) — near-real-time
 *   - Every 15 minutes: standard polling during full game hours (7 AM–6 PM PST)
 *   - Every 1 minute:   check if it's 11:59 PM PST for the nightly sweep
 *   - On startup:       immediate grade run for today + yesterday
 */
export function startBetAutoGradeScheduler(): void {
  console.log(`[BetAutoGrade][INPUT] startBetAutoGradeScheduler: STARTING`);

  // Immediate startup run — grade today + yesterday right away
  const { dateStr } = nowPst();
  const yesterday = yesterdayPst();
  console.log(`[BetAutoGrade][STEP] startBetAutoGradeScheduler: startup grade for today=${dateStr} yesterday=${yesterday}`);

  // Delay 10s to let DB connection pool warm up
  setTimeout(async () => {
    if (isGrading) return;
    isGrading = true;
    try {
      await gradeAllPendingForDate(dateStr, "startup");
      await gradeAllPendingForDate(yesterday, "startup_yesterday");
    } catch (err) {
      console.log(`[BetAutoGrade][ERROR] startup grade failed: ${(err as Error).message}`);
    } finally {
      isGrading = false;
    }
  }, 10_000);

  // Layer 1: 5-minute live polling during prime game hours (6 PM–2 AM PST)
  // .unref() prevents keeping process alive if server shuts down
  const LIVE_POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  livePollingInterval = setInterval(() => {
    runLivePollingGrade().catch(err => {
      console.log(`[BetAutoGrade][ERROR] live polling interval error: ${(err as Error).message}`);
    });
  }, LIVE_POLL_INTERVAL_MS).unref();

  // Layer 2: 15-minute standard polling during full game hours (7 AM–6 PM PST)
  const POLL_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
  standardPollingInterval = setInterval(() => {
    runPollingGrade().catch(err => {
      console.log(`[BetAutoGrade][ERROR] standard polling interval error: ${(err as Error).message}`);
    });
  }, POLL_INTERVAL_MS).unref();

  // Layer 3: 1-minute check for 11:59 PM PST nightly sweep
  const NIGHTLY_CHECK_INTERVAL_MS = 60 * 1000; // 1 minute
  nightlySweepInterval = setInterval(() => {
    runNightlySweep().catch(err => {
      console.log(`[BetAutoGrade][ERROR] nightly sweep check error: ${(err as Error).message}`);
    });
  }, NIGHTLY_CHECK_INTERVAL_MS).unref();

  console.log(`[BetAutoGrade][OUTPUT] startBetAutoGradeScheduler: STARTED`);
  console.log(`[BetAutoGrade][STATE] Live polling:     every 5 min during 6PM–2AM PST (prime game window)`);
  console.log(`[BetAutoGrade][STATE] Standard polling: every 15 min during 7AM–6PM PST (daytime games)`);
  console.log(`[BetAutoGrade][STATE] Nightly sweep:    11:59 PM PST — grades ALL PENDING bets across ALL dates`);
  console.log(`[BetAutoGrade][VERIFY] startBetAutoGradeScheduler: PASS — scheduler running`);
}

/**
 * Stop the scheduler (graceful shutdown / tests).
 */
export function stopBetAutoGradeScheduler(): void {
  if (livePollingInterval)     { clearInterval(livePollingInterval);     livePollingInterval = null; }
  if (standardPollingInterval) { clearInterval(standardPollingInterval); standardPollingInterval = null; }
  if (nightlySweepInterval)    { clearInterval(nightlySweepInterval);    nightlySweepInterval = null; }
  console.log(`[BetAutoGrade][OUTPUT] stopBetAutoGradeScheduler: STOPPED`);
}

/**
 * The shared grading surface. Consumed by:
 *   - this file's own in-process schedulers
 *   - POST /api/cron/bet-grade  (GitHub Actions timer — survives DISABLE_BACKGROUND_JOBS)
 *   - betTracker.autoGrade / autoGradeAll tRPC procedures
 */
export { gradeAllPendingForDate, gradeAllPendingAllDates };

/**
 * One-shot grade of today + yesterday across all users. This is what the cron
 * endpoint calls; it is the same work the 5/15-minute in-process pollers do,
 * without the time-window gating (the cron schedule IS the gate).
 */
/**
 * Look for bets that should have settled by now and alarm if any exist.
 *
 * Runs after a grading cycle, so anything still PENDING here has just had its
 * chance. Read-only; failure is swallowed.
 */
export async function checkStuckBets(): Promise<StuckBet[]> {
  try {
    const db = await getDb();
    const rows = await db.execute(sql`
      SELECT id, userId, sport, gameDate, awayTeam, homeTeam,
             TIMESTAMPDIFF(HOUR, CONCAT(gameDate, ' 00:00:00'), UTC_TIMESTAMP()) AS hoursPending
      FROM tracked_bets
      WHERE result = 'PENDING'
        AND TIMESTAMPDIFF(HOUR, CONCAT(gameDate, ' 00:00:00'), UTC_TIMESTAMP()) >= ${STUCK_THRESHOLD_HOURS}
      ORDER BY hoursPending DESC
      LIMIT 200
    `);
    const list = ((rows as unknown as Array<Array<Record<string, unknown>>>)[0] ?? []) as unknown as StuckBet[];
    const msg = describeStuckBets(list);
    if (msg) void gradingAlert("STUCK_BETS", msg);
    else console.log(`[BetAutoGrade][VERIFY] stuck-bet check: none beyond ${STUCK_THRESHOLD_HOURS}h`);
    return list;
  } catch (err) {
    console.warn(`[BetAutoGrade][WARN] stuck-bet check failed: ${(err as Error).message}`);
    return [];
  }
}

export async function runBetGradeCycle(trigger: string): Promise<
  { today: GradeSummary; yesterday: GradeSummary } | { skipped: true }
> {
  // Holds the SAME process mutex as the in-process pollers. Without it a
  // GitHub-triggered grade could run concurrently with the 5-minute poll.
  return withGradingLock("runBetGradeCycle", async () => {
    const { dateStr } = nowPst();
    const yesterday = yesterdayPst();
    const todaySummary = await gradeAllPendingForDate(dateStr, trigger);
    const yesterdaySummary = await gradeAllPendingForDate(yesterday, `${trigger}_yesterday`);
    await checkStuckBets();
    return { today: todaySummary, yesterday: yesterdaySummary };
  });
}

/**
 * Cron entry point for the all-dates sweep.
 *
 * Wraps `gradeAllPendingAllDates` in the grading mutex. The nightly in-process
 * sweep must NOT use this — it already holds the lock before it calls
 * `gradeAllPendingAllDates`, and taking it twice would make it skip itself.
 */
export async function runBetGradeSweep(trigger: string): Promise<{ skipped: boolean }> {
  const out = await withGradingLock("runBetGradeSweep", async () => {
    await gradeAllPendingAllDates(trigger);
    return { skipped: false };
  });
  return "skipped" in out ? { skipped: true } : out;
}
