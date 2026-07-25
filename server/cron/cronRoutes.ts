/**
 * cronRoutes.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * GitHub-Actions-triggered cron endpoints for the critical data-freshness jobs.
 *
 * These replace the always-on in-process setInterval schedulers (gated off on
 * Railway via DISABLE_BACKGROUND_JOBS to cut credit burn). Instead of the app
 * burning CPU 24/7 on timers, GitHub Actions fires each endpoint on a schedule
 * and the work runs once, on demand.
 *
 * Auth:   shared secret (CRON_SECRET) — see cronAuth.ts for why the Manus
 *         Heartbeat auth can't be reused off-Manus.
 * Path:   /api/cron/*  (deliberately distinct from the Manus /api/scheduled/*
 *         namespace so the two mechanisms never collide during the migration).
 * Shape:  respond 200 immediately, run work in the background under a run-lock.
 *
 * SCOPE (first pass — "critical data-freshness first"):
 *   - POST /api/cron/vsin-odds → runVsinRefresh()      (NBA/NHL/MLB VSiN + AN odds)
 *   - POST /api/cron/scores    → refreshAllScoresNow()  (live score refresh)
 *   - POST /api/cron/mlb-cycle → runMlbCycleOnce()      (MLB lineups/K-props/backtest writes)
 *   - GET  /api/cron/status    → run-lock state for all jobs (observability)
 *
 * SCOPE (second pass — MLB learning-loop ingestion, M-208): the outcome
 * ingestor, closing-line capture, and backtest enrollment previously existed
 * only as in-process schedulers that never fire under DISABLE_BACKGROUND_JOBS=1.
 *   - POST /api/cron/mlb-outcomes        → ingestMlbOutcomes()      (?date= or last 2 days PT)
 *   - POST /api/cron/mlb-closing-capture → captureClosingLines()    (lock DK NJ closing odds)
 *   - POST /api/cron/mlb-backtest        → runMultiMarketBacktest() (final games with no
 *                                          mlb_game_backtest rows; ?date= or last 3 days ET)
 *
 * DELIBERATELY NOT wired here: MLB model sync. runMlbModelForDate() spawns
 * /usr/bin/python3 (400k Monte-Carlo sims) which fails on Railway with
 * `spawn /usr/bin/python3 ENOENT`. Curling a Railway endpoint for it would just
 * error. It needs Python-in-the-runner (run the model inside the Actions job with
 * DB write-back), which is a separate follow-up — not an HTTP curl.
 */

import type { Express, Request, Response } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import { games } from "../../drizzle/schema";
import { requireCronSecret } from "./cronAuth";
import { CronJobRunner } from "./cronRunner";
import { runVsinRefresh, refreshAllScoresNow, runMlbCycleOnce } from "../vsinAutoRefresh";
import { runMlbAllStarGameSync } from "../mlbAllStarGameSync";
import { ingestMlbOutcomes } from "../mlbOutcomeIngestor";
import { captureClosingLines } from "../mlbScheduleHistoryService";
import { runMultiMarketBacktest } from "../mlbMultiMarketBacktest";
import { getDb } from "../db";

/** Most recent N calendar dates (YYYY-MM-DD, oldest first) in the given IANA zone. */
function lastNDates(n: number, timeZone: string): string[] {
  const dates: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    dates.push(new Date(Date.now() - i * 86_400_000).toLocaleDateString("en-CA", { timeZone }));
  }
  return dates;
}

// One runner per job — module-level so the run-lock survives across requests.
const vsinRunner = new CronJobRunner("vsin-odds", async () => {
  await runVsinRefresh();
});

const scoresRunner = new CronJobRunner("scores", async () => {
  await refreshAllScoresNow();
});

// MLB cycle — writes mlb_lineups, mlb_strikeout_props, mlb_game_backtest. Previously
// only reachable via the in-process 10-min interval; with DISABLE_BACKGROUND_JOBS set
// on Railway that interval never runs, so this endpoint is the only trigger. The
// run-lock below preserves the single-flight/overlap protection the interval relied on.
const mlbCycleRunner = new CronJobRunner("mlb-cycle", async () => {
  await runMlbCycleOnce();
});

// ── MLB learning-loop jobs (M-208) ──────────────────────────────────────────
// Date params are stashed module-level by the handler right before trigger().
// CronJobRunner.trigger() invokes the work function synchronously, and each
// work function copies the stash into a local before its first await, so a
// concurrent request can never mutate the date under an in-flight run.

let mlbOutcomesDateParam: string | null = null;
// Outcome ingestion (actualFgTotal/actualF5Total/actualNrfiBinary + Briers).
// ingestMlbOutcomes dates are PT (see mlbOutcomeIngestor.ts): default covers
// yesterday + today so late-night finals are picked up on the morning run.
const mlbOutcomesRunner = new CronJobRunner("mlb-outcomes", async () => {
  const dates = mlbOutcomesDateParam
    ? [mlbOutcomesDateParam]
    : lastNDates(2, "America/Los_Angeles");
  for (const dateStr of dates) {
    const s = await ingestMlbOutcomes(dateStr);
    console.log(
      `[Cron:mlb-outcomes] [OUTPUT] date=${dateStr} total=${s.totalGames} written=${s.written}` +
      ` skipped_ingested=${s.skippedAlreadyIngested} skipped_not_final=${s.skippedNotFinal}` +
      ` skipped_no_match=${s.skippedNoApiMatch} errors=${s.errors}`
    );
  }
});

// Closing-line capture — locks DK NJ closing odds at first pitch. Idempotent
// (skips rows with closingLineLockedAt set), so a 5-minute Actions cadence
// mirrors the retired in-process interval.
const mlbClosingCaptureRunner = new CronJobRunner("mlb-closing-capture", async () => {
  const r = await captureClosingLines();
  console.log(
    `[Cron:mlb-closing-capture] [OUTPUT] scanned=${r.scanned} locked=${r.locked}` +
    ` alreadyLocked=${r.alreadyLocked} noOdds=${r.noOdds} errors=${r.errors.length}`
  );
});

let mlbBacktestDateParam: string | null = null;
// Backtest enrollment — final MLB games with no mlb_game_backtest rows yet.
// The in-process trigger only fires on the FINAL transition it observes live,
// so any game that goes final while no job-runner is up is never enrolled.
const mlbBacktestRunner = new CronJobRunner("mlb-backtest", async () => {
  const dates = mlbBacktestDateParam
    ? [mlbBacktestDateParam]
    : lastNDates(3, "America/New_York"); // games.gameDate is the official ET date
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  const unenrolled = await db
    .select({ id: games.id, gameDate: games.gameDate, awayTeam: games.awayTeam, homeTeam: games.homeTeam })
    .from(games)
    .where(
      and(
        inArray(games.gameDate, dates),
        eq(games.sport, "MLB"),
        sql`LOWER(${games.gameStatus}) IN ('final', 'f', 'completed')`,
        sql`NOT EXISTS (SELECT 1 FROM mlb_game_backtest b WHERE b.gameId = ${games.id})`,
      )
    );
  console.log(
    `[Cron:mlb-backtest] [STATE] dates=[${dates.join(",")}] unenrolled=${unenrolled.length}`
  );
  let processed = 0;
  let errors = 0;
  for (const g of unenrolled) {
    try {
      await runMultiMarketBacktest(g.id, true);
      processed++;
    } catch (err) {
      errors++;
      console.error(
        `[Cron:mlb-backtest] [ERROR] game=${g.id} ${g.awayTeam}@${g.homeTeam} (${g.gameDate}): ` +
        (err instanceof Error ? err.message : String(err))
      );
    }
  }
  console.log(
    `[Cron:mlb-backtest] [OUTPUT] processed=${processed} errors=${errors} of ${unenrolled.length} unenrolled`
  );
  if (unenrolled.length > 0 && processed === 0) {
    throw new Error(`all ${errors} backtest enrollments failed`);
  }
});

/** Wire a POST endpoint that auth-guards, triggers the runner, responds 200. */
function mountJob(app: Express, path: string, label: string, runner: CronJobRunner): void {
  app.post(path, (req: Request, res: Response) => {
    if (!requireCronSecret(req, res, label)) return;

    const reqAt = new Date().toISOString();
    console.log(`[Cron:${label}] [INPUT] POST ${path} at ${reqAt} ip=${req.ip ?? "?"}`);

    const outcome = runner.trigger();

    console.log(
      `[Cron:${label}] [OUTPUT] started=${outcome.started} skipped=${outcome.skipped} ` +
      `lastRunAt=${outcome.lastRunAt ?? "never"}`
    );

    res.status(200).json({
      ok: true,
      job: label,
      startedAt: reqAt,
      started: outcome.started,
      skipped: outcome.skipped,
      lastResult: outcome.lastResult,
    });
  });
  console.log(`[Cron] [OUTPUT] Registered POST ${path} (job=${label})`);
}

/**
 * Like mountJob, but accepts an optional ?date=YYYY-MM-DD (query or body) and
 * stashes it via setDate before triggering — see the stash-safety note on the
 * MLB learning-loop runners above.
 */
function mountDateJob(
  app: Express,
  path: string,
  label: string,
  runner: CronJobRunner,
  setDate: (date: string | null) => void
): void {
  app.post(path, (req: Request, res: Response) => {
    if (!requireCronSecret(req, res, label)) return;

    const rawDate = req.query?.date ?? req.body?.date;
    const date = typeof rawDate === "string" && rawDate.length > 0 ? rawDate : null;
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ ok: false, error: "invalid-date", expected: "YYYY-MM-DD" });
      return;
    }

    const reqAt = new Date().toISOString();
    console.log(
      `[Cron:${label}] [INPUT] POST ${path} at ${reqAt} ip=${req.ip ?? "?"} date=${date ?? "auto"}`
    );

    setDate(date);
    const outcome = runner.trigger();

    console.log(
      `[Cron:${label}] [OUTPUT] started=${outcome.started} skipped=${outcome.skipped} ` +
      `lastRunAt=${outcome.lastRunAt ?? "never"}`
    );

    res.status(200).json({
      ok: true,
      job: label,
      startedAt: reqAt,
      date,
      started: outcome.started,
      skipped: outcome.skipped,
      lastResult: outcome.lastResult,
    });
  });
  console.log(`[Cron] [OUTPUT] Registered POST ${path} (job=${label})`);
}

export function registerCronRoutes(app: Express): void {
  mountJob(app, "/api/cron/vsin-odds", "vsin-odds", vsinRunner);
  mountJob(app, "/api/cron/scores", "scores", scoresRunner);
  mountJob(app, "/api/cron/mlb-cycle", "mlb-cycle", mlbCycleRunner);
  mountDateJob(app, "/api/cron/mlb-outcomes", "mlb-outcomes", mlbOutcomesRunner, (d) => {
    mlbOutcomesDateParam = d;
  });
  mountJob(app, "/api/cron/mlb-closing-capture", "mlb-closing-capture", mlbClosingCaptureRunner);
  mountDateJob(app, "/api/cron/mlb-backtest", "mlb-backtest", mlbBacktestRunner, (d) => {
    mlbBacktestDateParam = d;
  });

  // MLB All-Star Game (AL vs NL) seed/refresh. Unlike the fire-and-forget jobs
  // above, this runs synchronously and returns the book-vs-model tail + audit so
  // the mlb-asg.yml workflow can print/verify the result. `dryRun` scrapes +
  // computes without writing (pre-publish preview from the deployed server).
  app.post("/api/cron/mlb-asg", async (req: Request, res: Response) => {
    if (!requireCronSecret(req, res, "mlb-asg")) return;
    const dryRun =
      req.body?.dryRun === true || req.body?.dryRun === "true" || req.query?.dryRun === "true";
    console.log(`[Cron:mlb-asg] [INPUT] POST /api/cron/mlb-asg dryRun=${dryRun} at ${new Date().toISOString()}`);
    try {
      const result = await runMlbAllStarGameSync({ dryRun });
      console.log(`[Cron:mlb-asg] [OUTPUT] wrote=${result.wrote} auditPass=${result.audit.pass}\n${result.tail}`);
      res.status(result.audit.pass ? 200 : 500).json({ ok: result.audit.pass, ...result });
    } catch (err) {
      console.error(`[Cron:mlb-asg] [ERROR]`, err);
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });
  console.log(`[Cron] [OUTPUT] Registered POST /api/cron/mlb-asg (job=mlb-asg)`);

  // Observability: read-only run-lock state for all jobs (still secret-guarded so
  // it can't be scraped anonymously). Handy for the CI perf harness and debugging.
  app.get("/api/cron/status", (req: Request, res: Response) => {
    if (!requireCronSecret(req, res, "status")) return;
    res.status(200).json({
      ok: true,
      jobs: {
        "vsin-odds": vsinRunner.state,
        scores: scoresRunner.state,
        "mlb-cycle": mlbCycleRunner.state,
        "mlb-outcomes": mlbOutcomesRunner.state,
        "mlb-closing-capture": mlbClosingCaptureRunner.state,
        "mlb-backtest": mlbBacktestRunner.state,
      },
    });
  });
  console.log(`[Cron] [OUTPUT] Registered GET /api/cron/status`);
}
