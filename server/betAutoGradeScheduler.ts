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
import { trackedBets } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";
import {
  gradeTrackedBet,
  fetchScores,
  type Sport as GraderSport,
  type Timeframe as GraderTimeframe,
  type Market as GraderMarket,
  type PickSide as GraderPickSide,
} from "./scoreGrader";
import { invalidateStatsCacheForUser } from "./routers/betTracker";

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

interface GradeSummary {
  date: string;
  total: number;
  graded: number;
  wins: number;
  losses: number;
  pushes: number;
  stillPending: number;
  errors: number;
}

/**
 * Grade all PENDING bets for a specific date across all users.
 * Persists awayScore + homeScore on each settled bet.
 *
 * CRITICAL: passes customLine (overrides line), gameNumber (DH support),
 * and invalidates stats cache for each affected user after grading.
 */
async function gradeAllPendingForDate(date: string, trigger: string): Promise<GradeSummary> {
  console.log(`[BetAutoGrade][INPUT] gradeAllPendingForDate: date=${date} trigger=${trigger}`);

  const db = await getDb();

  // Fetch all PENDING bets for this date
  const pending = await db.select().from(trackedBets).where(
    and(
      eq(trackedBets.result, "PENDING"),
      eq(trackedBets.gameDate, date),
    )
  );

  if (pending.length === 0) {
    console.log(`[BetAutoGrade][STATE] gradeAllPendingForDate: 0 PENDING bets for date=${date} — skipping`);
    return { date, total: 0, graded: 0, wins: 0, losses: 0, pushes: 0, stillPending: 0, errors: 0 };
  }

  console.log(`[BetAutoGrade][STATE] gradeAllPendingForDate: ${pending.length} PENDING bets for date=${date}`);

  // Pre-fetch scores for all sports in parallel (warm the cache)
  const sportsNeeded = Array.from(new Set(pending.map((b: { sport: string }) => b.sport))) as GraderSport[];
  console.log(`[BetAutoGrade][STEP] gradeAllPendingForDate: pre-fetching scores for sports=[${sportsNeeded.join(",")}]`);

  await Promise.all(sportsNeeded.map(s => fetchScores(s, date).catch(err => {
    console.log(`[BetAutoGrade][ERROR] score pre-fetch failed: sport=${s} date=${date} err=${(err as Error).message}`);
  })));
  console.log(`[BetAutoGrade][STATE] gradeAllPendingForDate: score pre-fetch complete for ${sportsNeeded.length} sports`);

  let graded = 0, wins = 0, losses = 0, pushes = 0, stillPending = 0, errors = 0;
  // Track which users had bets graded — for stats cache invalidation
  const gradedUserIds = new Set<number>();

  for (const bet of pending) {
    try {
      // CRITICAL FIX: use customLine if set (overrides default line for custom total/RL bets)
      const gradeLineValue = bet.customLine != null
        ? parseFloat(String(bet.customLine))
        : (bet.line != null ? parseFloat(String(bet.line)) : null);

      console.log(`[BetAutoGrade][STEP] grading betId=${bet.id} sport=${bet.sport} ${bet.awayTeam}@${bet.homeTeam} timeframe=${bet.timeframe} market=${bet.market} pickSide=${bet.pickSide} line=${gradeLineValue} customLine=${bet.customLine ?? "null"} gameNumber=${bet.gameNumber ?? 1}`);

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
        // CRITICAL FIX: pass gameNumber for doubleheader G2 support
        gameNumber: (bet.gameNumber ?? 1) as 1 | 2,
      });

      if (gradeOut.result === "PENDING") {
        stillPending++;
        console.log(`[BetAutoGrade][STATE] betId=${bet.id} still PENDING: ${gradeOut.reason}`);
        continue;
      }

      // Persist result + scores
      const updatePayload: Record<string, string | null> = {
        result:    gradeOut.result,
        awayScore: gradeOut.awayScore !== null ? String(gradeOut.awayScore) : null,
        homeScore: gradeOut.homeScore !== null ? String(gradeOut.homeScore) : null,
      };
      // Self-heal: fix blank team names from the grader's resolved abbreviations
      if (gradeOut.awayAbbrev && (!bet.awayTeam || bet.awayTeam === "OPP" || bet.awayTeam.trim() === "")) {
        updatePayload.awayTeam = gradeOut.awayAbbrev;
        console.log(`[BetAutoGrade][STATE] betId=${bet.id} — fixing awayTeam from "${bet.awayTeam}" to "${gradeOut.awayAbbrev}"`);
      }
      if (gradeOut.homeAbbrev && (!bet.homeTeam || bet.homeTeam === "OPP" || bet.homeTeam.trim() === "")) {
        updatePayload.homeTeam = gradeOut.homeAbbrev;
        console.log(`[BetAutoGrade][STATE] betId=${bet.id} — fixing homeTeam from "${bet.homeTeam}" to "${gradeOut.homeAbbrev}"`);
      }

      await db.update(trackedBets)
        .set(updatePayload)
        .where(eq(trackedBets.id, bet.id));

      // Track user for stats cache invalidation
      gradedUserIds.add(bet.userId);

      graded++;
      if (gradeOut.result === "WIN")  wins++;
      if (gradeOut.result === "LOSS") losses++;
      if (gradeOut.result === "PUSH") pushes++;

      console.log(`[BetAutoGrade][OUTPUT] betId=${bet.id} userId=${bet.userId} sport=${bet.sport} ${bet.awayTeam}@${bet.homeTeam} → ${gradeOut.result} | score=${gradeOut.awayScore}-${gradeOut.homeScore} | ${gradeOut.reason}`);
      console.log(`[BetAutoGrade][VERIFY] betId=${bet.id} PASS — result=${gradeOut.result} persisted`);

    } catch (err) {
      errors++;
      console.log(`[BetAutoGrade][ERROR] betId=${bet.id} grading failed: ${(err as Error).message}`);
    }
  }

  // CRITICAL FIX: invalidate stats cache for all users who had bets graded
  // Without this, W/L/ROI stats remain stale until the 30s TTL expires
  if (gradedUserIds.size > 0) {
    const gradedUserIdArr = Array.from(gradedUserIds);
    for (const uid of gradedUserIdArr) {
      invalidateStatsCacheForUser(uid);
    }
    console.log(`[BetAutoGrade][STATE] gradeAllPendingForDate: invalidated stats cache for ${gradedUserIds.size} users: [${gradedUserIdArr.join(",")}]`);
  }

  const summary: GradeSummary = { date, total: pending.length, graded, wins, losses, pushes, stillPending, errors };
  console.log(`[BetAutoGrade][OUTPUT] gradeAllPendingForDate: COMPLETE date=${date} total=${pending.length} graded=${graded} wins=${wins} losses=${losses} pushes=${pushes} stillPending=${stillPending} errors=${errors}`);
  console.log(`[BetAutoGrade][VERIFY] gradeAllPendingForDate: ${errors === 0 ? "PASS" : "WARN"} — ${errors} errors`);
  return summary;
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

  for (const date of dates) {
    const summary = await gradeAllPendingForDate(date, trigger);
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
let isGrading = false; // Mutex: prevent concurrent grade runs

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
  const { hour, minute } = nowPst();

  // HARDCODED: fire at exactly 11:59 PM PST.
  // Window: 23:57 – 23:59 PST (3-minute window for the 1-minute check interval).
  // PST = UTC-8 (winter) / PDT = UTC-7 (summer) — handled automatically by Intl.
  const isNightlyWindow = hour === 23 && minute >= 57 && minute <= 59;

  if (!isNightlyWindow) return;

  if (isGrading) {
    console.log(`[BetAutoGrade][STEP] runNightlySweep: SKIP — grade already in progress`);
    return;
  }

  isGrading = true;
  console.log(`[BetAutoGrade][INPUT] runNightlySweep: TRIGGERED at 11:59 PM PST — grading ALL PENDING bets across ALL dates`);

  try {
    await gradeAllPendingAllDates("nightly_sweep_11:59PM_PST");
    console.log(`[BetAutoGrade][VERIFY] runNightlySweep: PASS — nightly sweep complete`);
  } catch (err) {
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
 * Stop the scheduler (for testing or graceful shutdown).
 */
export function stopBetAutoGradeScheduler(): void {
  if (livePollingInterval)     { clearInterval(livePollingInterval);     livePollingInterval = null; }
  if (standardPollingInterval) { clearInterval(standardPollingInterval); standardPollingInterval = null; }
  if (nightlySweepInterval)    { clearInterval(nightlySweepInterval);    nightlySweepInterval = null; }
  console.log(`[BetAutoGrade][OUTPUT] stopBetAutoGradeScheduler: STOPPED`);
}

/**
 * Exported for direct use in autoGrade/autoGradeAll tRPC procedures
 * to persist scores when grading via the UI button as well.
 */
export { gradeAllPendingForDate, gradeAllPendingAllDates };
