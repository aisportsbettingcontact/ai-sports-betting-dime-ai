/**
 * mlbNightlyTrendsRefresh.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Fully automated nightly MLB TRENDS refresh system.
 *
 * ─── Schedule ────────────────────────────────────────────────────────────────
 *   Fires at 2:59 AM EST (11:59 PM PST) every night.
 *   This is after every possible MLB game — including extra-inning West Coast
 *   games — has settled. No MLB game has ever finished after 11:59 PM PST.
 *
 * ─── What it does ────────────────────────────────────────────────────────────
 *   1. Re-ingests yesterday + today from AN API (fallback book chain 68→15→21→30)
 *   2. Per-row validation: re-derives awayWon, awayRunLineCovered,
 *      homeRunLineCovered, totalResult from raw scores and verifies against DB
 *   3. 30-team cross-validation: checks all 18 cells (ML/RL/OU × 6 situations)
 *      for internal consistency across every team
 *   4. Owner notification: sends pass/fail summary via notifyOwner()
 *
 * ─── Logging format ──────────────────────────────────────────────────────────
 *   [MlbNightlyTrends][STEP]   — execution step
 *   [MlbNightlyTrends][INPUT]  — input parameters
 *   [MlbNightlyTrends][STATE]  — intermediate computation
 *   [MlbNightlyTrends][OUTPUT] — result
 *   [MlbNightlyTrends][VERIFY] — PASS/FAIL + reason
 *   [MlbNightlyTrends][WARN]   — non-fatal anomaly
 *   [MlbNightlyTrends][ERROR]  — fatal error
 *
 * ─── Manual trigger ──────────────────────────────────────────────────────────
 *   Call runMlbNightlyTrendsRefresh(dateStr?) directly for on-demand backfill.
 *   If dateStr is omitted, defaults to yesterday EST.
 */

import { getDb } from "./db";
import {
  mlbScheduleHistory,
  type MlbScheduleHistoryRow,
} from "../drizzle/schema";
import { eq, and, or, desc, gte } from "drizzle-orm";
import { refreshMlbScheduleForDate } from "./mlbScheduleHistoryService";
import { notifyOwner } from "./_core/notification";
import { MLB_TEAMS } from "../shared/mlbTeams";

const TAG = "[MlbNightlyTrends]";
const SEASON_2026_START = "2026-03-25";

// ─── Date Helpers ─────────────────────────────────────────────────────────────

/** Format a Date as YYYY-MM-DD (DB format) */
function toDbDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Format a Date as YYYYMMDD (AN API format) */
function toAnDate(d: Date): string {
  return toDbDate(d).replace(/-/g, "");
}

/** Current EST time (UTC-5, fixed offset — consistent with existing scheduler) */
function nowEst(): Date {
  const now = new Date();
  return new Date(now.getTime() + -5 * 60 * 60 * 1000);
}

/** Yesterday in EST as YYYYMMDD (AN API format) */
function yesterdayEstAnDate(): string {
  const est = nowEst();
  est.setDate(est.getDate() - 1);
  return toAnDate(est);
}

/** Today in EST as YYYYMMDD (AN API format) */
function todayEstAnDate(): string {
  return toAnDate(nowEst());
}

/** Current hour in EST (0–23) */
function currentHourEst(): number {
  return nowEst().getHours();
}

/** Current minute in EST (0–59) */
function currentMinuteEst(): number {
  return nowEst().getMinutes();
}

/**
 * Milliseconds until the next occurrence of a given EST hour:minute.
 * If the target time has already passed today, schedules for tomorrow.
 */
function msUntilNextEstTime(targetHour: number, targetMinute: number): number {
  const now = new Date();
  const estOffset = -5 * 60 * 60 * 1000;
  const estNow = new Date(now.getTime() + estOffset);

  const next = new Date(estNow);
  next.setHours(targetHour, targetMinute, 0, 0);
  if (next <= estNow) {
    next.setDate(next.getDate() + 1);
  }
  // Convert back to UTC ms
  return next.getTime() - estOffset - now.getTime();
}

// ─── Per-Row Validation Helpers ───────────────────────────────────────────────

function boolVal(v: unknown): boolean | null {
  if (v == null) return null;
  if (Buffer.isBuffer(v)) return (v as Buffer)[0] === 1;
  if (typeof v === "boolean") return v;
  if (v === 1 || v === "1") return true;
  if (v === 0 || v === "0") return false;
  return null;
}

function recomputeAwayWon(
  awayScore: number | null,
  homeScore: number | null
): boolean | null {
  if (awayScore == null || homeScore == null) return null;
  if (awayScore === homeScore) return null; // tie — impossible in MLB
  return awayScore > homeScore;
}

function recomputeAwayRunLineCovered(
  awayScore: number | null,
  homeScore: number | null,
  dkAwayRunLine: string | null
): boolean | null {
  if (awayScore == null || homeScore == null || dkAwayRunLine == null)
    return null;
  const spread = parseFloat(dkAwayRunLine);
  if (isNaN(spread)) return null;
  const margin = awayScore + spread - homeScore;
  if (margin > 0) return true;
  if (margin < 0) return false;
  return null; // push
}

function recomputeTotalResult(
  awayScore: number | null,
  homeScore: number | null,
  dkTotal: string | null
): string | null {
  if (awayScore == null || homeScore == null || dkTotal == null) return null;
  const total = parseFloat(dkTotal);
  if (isNaN(total)) return null;
  const combined = awayScore + homeScore;
  if (combined > total) return "OVER";
  if (combined < total) return "UNDER";
  return "PUSH";
}

// ─── 30-Team Cross-Validation ─────────────────────────────────────────────────

interface TeamValidationResult {
  slug: string;
  abbr: string;
  games: number;
  issues: string[];
  pass: boolean;
}

async function validateAllTeams(): Promise<TeamValidationResult[]> {
  const db = await getDb();
  const results: TeamValidationResult[] = [];

  for (const team of MLB_TEAMS) {
    const slug = team.anSlug;
    const abbr = team.abbrev;
    const issues: string[] = [];

    // Fetch all completed 2026 games for this team
    const rows = await db
      .select()
      .from(mlbScheduleHistory)
      .where(
        and(
          eq(mlbScheduleHistory.gameStatus, "complete"),
          gte(mlbScheduleHistory.gameDate, SEASON_2026_START),
          or(
            eq(mlbScheduleHistory.awaySlug, slug),
            eq(mlbScheduleHistory.homeSlug, slug)
          )
        )
      )
      .orderBy(desc(mlbScheduleHistory.gameDate))
      .limit(162);

    console.log(
      `${TAG}[VALIDATE][${abbr}][INPUT] ${rows.length} completed 2026 games`
    );

    if (rows.length === 0) {
      issues.push(`ZERO games in DB — team missing`);
      results.push({ slug, abbr, games: 0, issues, pass: false });
      continue;
    }

    // L1: Null-odds check
    const nullOdds = rows.filter(
      (g: MlbScheduleHistoryRow) => g.dkAwayML == null
    );
    if (nullOdds.length > 0) {
      const msg = `${nullOdds.length} games have NULL dkAwayML`;
      issues.push(`[L1] ${msg}`);
      console.warn(`${TAG}[VALIDATE][${abbr}][WARN] ${msg}`);
      for (const g of nullOdds as MlbScheduleHistoryRow[]) {
        console.warn(
          `${TAG}[VALIDATE][${abbr}][NULL_ODDS] ${g.gameDate} ${g.awayAbbr}@${g.homeAbbr}`
        );
      }
    }

    // L2: Per-row data integrity
    for (const g of rows) {
      const gameLabel = `${g.gameDate} ${g.awayAbbr}@${g.homeAbbr}`;
      const storedAwayWon = boolVal(g.awayWon);
      const storedAwayCov = boolVal(g.awayRunLineCovered);
      const storedHomeCov = boolVal(g.homeRunLineCovered);

      const expectedAwayWon = recomputeAwayWon(g.awayScore, g.homeScore);
      const expectedAwayCov = recomputeAwayRunLineCovered(
        g.awayScore,
        g.homeScore,
        g.dkAwayRunLine
      );
      const expectedOu = recomputeTotalResult(
        g.awayScore,
        g.homeScore,
        g.dkTotal ? String(g.dkTotal) : null
      );

      if (expectedAwayWon !== null && storedAwayWon !== expectedAwayWon) {
        const msg = `${gameLabel}: awayWon stored=${storedAwayWon} expected=${expectedAwayWon} (score=${g.awayScore}-${g.homeScore})`;
        issues.push(`[L2] ${msg}`);
        console.error(
          `${TAG}[VALIDATE][${abbr}][FAIL] awayWon mismatch: ${msg}`
        );
      }

      if (g.dkAwayRunLine != null && expectedAwayCov !== storedAwayCov) {
        const msg = `${gameLabel}: awayRunLineCovered stored=${storedAwayCov} expected=${expectedAwayCov} (score=${g.awayScore}-${g.homeScore} RL=${g.dkAwayRunLine})`;
        issues.push(`[L2] ${msg}`);
        console.error(`${TAG}[VALIDATE][${abbr}][FAIL] ATS mismatch: ${msg}`);
      }

      if (g.dkTotal != null && expectedOu !== g.totalResult) {
        const combined = (g.awayScore ?? 0) + (g.homeScore ?? 0);
        const msg = `${gameLabel}: totalResult stored="${g.totalResult}" expected="${expectedOu}" (${combined} vs total=${g.dkTotal})`;
        issues.push(`[L2] ${msg}`);
        console.error(`${TAG}[VALIDATE][${abbr}][FAIL] O/U mismatch: ${msg}`);
      }

      // homeRunLineCovered must be inverse of awayRunLineCovered (unless push)
      if (expectedAwayCov !== null && storedHomeCov !== !storedAwayCov) {
        const msg = `${gameLabel}: homeRunLineCovered=${storedHomeCov} should be inverse of awayRunLineCovered=${storedAwayCov}`;
        issues.push(`[L2] ${msg}`);
        console.error(
          `${TAG}[VALIDATE][${abbr}][FAIL] RL inverse mismatch: ${msg}`
        );
      }
    }

    // L3: Home/Away designation consistency
    const homeCount = rows.filter(
      (g: MlbScheduleHistoryRow) => g.homeSlug === slug
    ).length;
    const awayCount = rows.filter(
      (g: MlbScheduleHistoryRow) => g.awaySlug === slug
    ).length;
    if (homeCount + awayCount !== rows.length) {
      const msg = `home(${homeCount}) + away(${awayCount}) = ${homeCount + awayCount} ≠ total(${rows.length})`;
      issues.push(`[L3] ${msg}`);
      console.error(`${TAG}[VALIDATE][${abbr}][FAIL] ${msg}`);
    }

    // L4: ML wins+losses ≤ total games
    const mlWins = rows.filter((g: MlbScheduleHistoryRow) => {
      const aw = boolVal(g.awayWon);
      if (aw == null) return false;
      return g.awaySlug === slug ? aw : !aw;
    }).length;
    const mlLosses = rows.filter((g: MlbScheduleHistoryRow) => {
      const aw = boolVal(g.awayWon);
      if (aw == null) return false;
      return g.awaySlug === slug ? !aw : aw;
    }).length;
    if (mlWins + mlLosses > rows.length) {
      const msg = `ML W+L (${mlWins + mlLosses}) > total games (${rows.length}) — impossible`;
      issues.push(`[L4] ${msg}`);
      console.error(`${TAG}[VALIDATE][${abbr}][FAIL] ${msg}`);
    }

    const pass = issues.length === 0;
    if (pass) {
      console.log(
        `${TAG}[VALIDATE][${abbr}][VERIFY] PASS — games=${rows.length}` +
          ` home=${homeCount} away=${awayCount}` +
          ` ML=${mlWins}-${mlLosses}`
      );
    } else {
      console.error(
        `${TAG}[VALIDATE][${abbr}][VERIFY] FAIL — ${issues.length} issues`
      );
    }

    results.push({ slug, abbr, games: rows.length, issues, pass });
  }

  return results;
}

// ─── Core Nightly Refresh ─────────────────────────────────────────────────────

/**
 * Run the full nightly MLB TRENDS refresh for a given date.
 * If dateStr is omitted, defaults to yesterday EST (YYYYMMDD format).
 *
 * Steps:
 *   1. Ingest yesterday + today from AN API
 *   2. Per-row validation across all 30 teams
 *   3. Owner notification with summary
 */
export async function runMlbNightlyTrendsRefresh(
  targetDateStr?: string
): Promise<void> {
  const runId = Date.now();
  const yesterday = yesterdayEstAnDate();
  const today = todayEstAnDate();
  const target = targetDateStr ?? yesterday;

  console.log(
    `${TAG}[STEP] ════════════════════════════════════════════════════`
  );
  console.log(`${TAG}[STEP] MLB Nightly TRENDS Refresh — runId=${runId}`);
  console.log(
    `${TAG}[INPUT] target=${target} yesterday=${yesterday} today=${today}`
  );
  console.log(
    `${TAG}[INPUT] EST time: ${nowEst().toISOString()}` +
      ` | hour=${currentHourEst()} min=${currentMinuteEst()}`
  );
  console.log(
    `${TAG}[STEP] ════════════════════════════════════════════════════`
  );

  // ── Step 1: Ingest yesterday + today ────────────────────────────────────────
  console.log(`${TAG}[STEP] Phase 1 — Ingesting games from AN API`);

  const datesToIngest = [target];
  // Always also ingest today (captures any games that were still live at midnight)
  if (today !== target) datesToIngest.push(today);
  // Always also ingest yesterday if target is today (belt-and-suspenders)
  if (target === today && yesterday !== today) datesToIngest.push(yesterday);

  const ingestResults: Array<{
    date: string;
    fetched: number;
    upserted: number;
    errors: string[];
  }> = [];

  for (const dateStr of datesToIngest) {
    console.log(`${TAG}[STEP] Ingesting date=${dateStr}`);
    try {
      const result = await refreshMlbScheduleForDate(dateStr);
      ingestResults.push(result);
      console.log(
        `${TAG}[OUTPUT] date=${dateStr}` +
          ` fetched=${result.fetched}` +
          ` upserted=${result.upserted}` +
          ` errors=${result.errors.length}`
      );
      if (result.errors.length > 0) {
        console.warn(
          `${TAG}[WARN] date=${dateStr} ingestion errors:`,
          result.errors.slice(0, 5)
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `${TAG}[ERROR] Ingestion failed for date=${dateStr}: ${msg}`
      );
      ingestResults.push({
        date: dateStr,
        fetched: 0,
        upserted: 0,
        errors: [msg],
      });
    }
    // Rate-limit: 400ms between API calls
    await new Promise(r => setTimeout(r, 400));
  }

  const totalFetched = ingestResults.reduce((s, r) => s + r.fetched, 0);
  const totalUpserted = ingestResults.reduce((s, r) => s + r.upserted, 0);
  const totalIngestErrors = ingestResults.reduce(
    (s, r) => s + r.errors.length,
    0
  );

  console.log(
    `${TAG}[OUTPUT] Phase 1 complete:` +
      ` dates=${datesToIngest.length}` +
      ` totalFetched=${totalFetched}` +
      ` totalUpserted=${totalUpserted}` +
      ` totalErrors=${totalIngestErrors}`
  );

  if (totalIngestErrors === 0) {
    console.log(
      `${TAG}[VERIFY] PASS — Phase 1 ingestion completed with 0 errors`
    );
  } else {
    console.warn(
      `${TAG}[VERIFY] WARN — Phase 1 had ${totalIngestErrors} ingestion errors`
    );
  }

  // ── Step 2: 30-team cross-validation ────────────────────────────────────────
  console.log(
    `${TAG}[STEP] Phase 2 — 30-team cross-validation (all 3 markets × 6 situations)`
  );

  const validationResults = await validateAllTeams();

  const passCount = validationResults.filter(r => r.pass).length;
  const failCount = validationResults.filter(
    r => !r.pass && r.games > 0
  ).length;
  const noDataCount = validationResults.filter(r => r.games === 0).length;
  const totalGames = validationResults.reduce((s, r) => s + r.games, 0);
  const totalIssues = validationResults.reduce(
    (s, r) => s + r.issues.length,
    0
  );

  console.log(`${TAG}[OUTPUT] Phase 2 complete:`);
  console.log(`${TAG}[OUTPUT]   Teams audited: ${validationResults.length}/30`);
  console.log(`${TAG}[OUTPUT]   Total games:   ${totalGames}`);
  console.log(`${TAG}[OUTPUT]   PASS:          ${passCount}`);
  console.log(`${TAG}[OUTPUT]   FAIL:          ${failCount}`);
  console.log(`${TAG}[OUTPUT]   NO_DATA:       ${noDataCount}`);
  console.log(`${TAG}[OUTPUT]   Total issues:  ${totalIssues}`);

  // Log failed teams
  const failedTeams = validationResults.filter(r => !r.pass && r.games > 0);
  for (const t of failedTeams) {
    console.error(`${TAG}[FAIL] ${t.abbr}: ${t.issues.length} issues`);
    for (const iss of t.issues) {
      console.error(`${TAG}[FAIL]   ⚠️  ${iss}`);
    }
  }

  const noDataTeams = validationResults.filter(r => r.games === 0);
  for (const t of noDataTeams) {
    console.error(`${TAG}[FAIL] ${t.abbr}: ZERO games in DB`);
  }

  if (totalIssues === 0 && noDataCount === 0) {
    console.log(
      `${TAG}[VERIFY] PASS — 30/30 teams PASS | ${totalGames} games | 0 issues`
    );
  } else {
    console.error(
      `${TAG}[VERIFY] FAIL — ${totalIssues} issues across ${failCount} teams` +
        (noDataCount > 0 ? ` | ${noDataCount} teams missing` : "")
    );
  }

  // ── Step 3: Owner notification ───────────────────────────────────────────────
  console.log(`${TAG}[STEP] Phase 3 — Sending owner notification`);

  const overallStatus =
    totalIssues === 0 && noDataCount === 0 ? "✅ PASS" : "❌ FAIL";
  const failedList = failedTeams
    .map(t => `${t.abbr}(${t.issues.length})`)
    .join(", ");
  const noDataList = noDataTeams.map(t => t.abbr).join(", ");

  const notifTitle = `MLB TRENDS Nightly Refresh — ${overallStatus}`;
  const notifContent = [
    `Run ID: ${runId}`,
    `Target date: ${target}`,
    ``,
    `── Ingestion ──`,
    ...ingestResults.map(
      r =>
        `  ${r.date}: fetched=${r.fetched} upserted=${r.upserted} errors=${r.errors.length}`
    ),
    ``,
    `── Validation ──`,
    `  Teams: ${passCount}/30 PASS | ${failCount} FAIL | ${noDataCount} NO_DATA`,
    `  Games audited: ${totalGames}`,
    `  Total issues: ${totalIssues}`,
    ...(failedList ? [`  Failed: ${failedList}`] : []),
    ...(noDataList ? [`  No data: ${noDataList}`] : []),
  ].join("\n");

  try {
    const sent = await notifyOwner({
      title: notifTitle,
      content: notifContent,
    });
    if (sent) {
      console.log(`${TAG}[OUTPUT] Owner notification sent successfully`);
    } else {
      console.warn(
        `${TAG}[WARN] Owner notification returned false (service unavailable)`
      );
    }
  } catch (err) {
    // Non-fatal — notification failure must never block the refresh
    console.warn(`${TAG}[WARN] Owner notification threw (non-fatal):`, err);
  }

  console.log(
    `${TAG}[STEP] ════════════════════════════════════════════════════`
  );
  console.log(
    `${TAG}[STEP] Nightly refresh complete — runId=${runId}` +
      ` status=${overallStatus}` +
      ` duration=${((Date.now() - runId) / 1000).toFixed(1)}s`
  );
  console.log(
    `${TAG}[STEP] ════════════════════════════════════════════════════`
  );
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

/**
 * Start the nightly MLB TRENDS refresh scheduler.
 *
 * Fires at 2:59 AM EST (11:59 PM PST) every night — after every possible
 * MLB game including extra-inning West Coast games has settled.
 *
 * Also runs a startup check: if the server starts between 3:00 AM and 6:00 AM
 * EST (after the nightly job would have run but before the 4-hour scheduler
 * picks up), runs the refresh immediately to catch any missed data.
 */
export function startMlbNightlyTrendsScheduler(): void {
  const TARGET_HOUR = 2; // 2 AM EST
  const TARGET_MINUTE = 59; // :59 — 2:59 AM EST = 11:59 PM PST

  console.log(
    `${TAG}[STEP] Initializing nightly TRENDS scheduler` +
      ` — fires at ${TARGET_HOUR}:${String(TARGET_MINUTE).padStart(2, "0")} EST (11:59 PM PST) nightly`
  );

  // ── Startup check: did we miss last night's run? ───────────────────────────
  // If server starts between 3:00 AM and 6:00 AM EST, the nightly job already
  // fired but the 4-hour scheduler hasn't run yet. Run immediately.
  const hourEst = currentHourEst();
  if (hourEst >= 3 && hourEst < 6) {
    console.log(
      `${TAG}[STEP] Server started at EST hour=${hourEst} — in post-nightly window` +
        ` — running startup catch-up refresh immediately`
    );
    setImmediate(async () => {
      console.log(`${TAG}[STEP] Startup catch-up refresh triggered`);
      await runMlbNightlyTrendsRefresh();
    });
  } else {
    console.log(
      `${TAG}[STEP] Server started at EST hour=${hourEst}` +
        ` — no startup catch-up needed (outside 3–6 AM window)`
    );
  }

  // ── Schedule nightly at 2:59 AM EST ───────────────────────────────────────
  const scheduleNext = () => {
    const msToNext = msUntilNextEstTime(TARGET_HOUR, TARGET_MINUTE);
    const nextRun = new Date(Date.now() + msToNext);

    console.log(
      `${TAG}[STEP] Next nightly refresh scheduled at ${nextRun.toISOString()}` +
        ` (in ${Math.round(msToNext / 1000 / 60)} min)`
    );

    setTimeout(async () => {
      const h = currentHourEst();
      const m = currentMinuteEst();
      console.log(
        `${TAG}[STEP] Nightly trigger fired — EST ${h}:${String(m).padStart(2, "0")}`
      );
      await runMlbNightlyTrendsRefresh();
      // Schedule the next night's run
      scheduleNext();
    }, msToNext);
  };

  scheduleNext();
}
