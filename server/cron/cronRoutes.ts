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
 * Auth:   shared secret (CRON_SECRET) — see cronAuth.ts for why the legacy
 *         heartbeat auth can't be reused off the legacy platform.
 * Path:   /api/cron/*  (deliberately distinct from the legacy /api/scheduled/*
 *         namespace so the two mechanisms never collide during the migration).
 * Shape:  respond 200 immediately, run work in the background under a run-lock.
 *
 * SCOPE (first pass — "critical data-freshness first"):
 *   - POST /api/cron/vsin-odds → runVsinRefresh()      (NBA/NHL/MLB VSiN + AN odds)
 *   - POST /api/cron/scores    → refreshAllScoresNow()  (live score refresh)
 *   - POST /api/cron/mlb-cycle → runMlbCycleOnce()      (MLB lineups/K-props/backtest writes)
 *   - GET  /api/cron/status    → run-lock state for all jobs (observability)
 *
 * DELIBERATELY NOT wired here: MLB model sync. runMlbModelForDate() spawns
 * /usr/bin/python3 (400k Monte-Carlo sims) which fails on Railway with
 * `spawn /usr/bin/python3 ENOENT`. Curling a Railway endpoint for it would just
 * error. It needs Python-in-the-runner (run the model inside the Actions job with
 * DB write-back), which is a separate follow-up — not an HTTP curl.
 */

import type { Express, Request, Response } from "express";
import { requireCronSecret } from "./cronAuth";
import { resolveClientIdentity } from "../_core/clientIdentity";
import { CronJobRunner } from "./cronRunner";
import { runVsinRefresh, refreshAllScoresNow, runMlbCycleOnce } from "../vsinAutoRefresh";
import { runMlbAllStarGameSync } from "../mlbAllStarGameSync";
import { runBetGradeCycle, runBetGradeSweep } from "../betAutoGradeScheduler";
import { reconcileStripeSubscriptions, formatReconcileReport } from "../stripe/reconcile";
import { billingAlert } from "../_core/billingAlerts";

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

// Bet grading — settles PENDING tracked bets for today + yesterday.
//
// Why this exists: grading lived ONLY inside the in-process scheduler, which
// sits behind the DISABLE_BACKGROUND_JOBS kill switch. Flipping that flag to cut
// Railway credits would have stopped bet settlement entirely, silently — no
// error, bets simply never leave PENDING. This endpoint gives grading the same
// cron-triggered path the other data-freshness jobs already have, under the same
// single-flight run-lock.
const betGradeRunner = new CronJobRunner("bet-grade", async () => {
  await runBetGradeCycle("cron_bet_grade");
});

// Nightly catch-all — every PENDING bet across every date, not just today and
// yesterday. Picks up anything the incremental cycle missed (late finals,
// upstream feed outages, bets logged for older dates).
const betGradeSweepRunner = new CronJobRunner("bet-grade-sweep", async () => {
  await runBetGradeSweep("cron_bet_grade_sweep");
});

/** Wire a POST endpoint that auth-guards, triggers the runner, responds 200. */
function mountJob(app: Express, path: string, label: string, runner: CronJobRunner): void {
  app.post(path, (req: Request, res: Response) => {
    if (!requireCronSecret(req, res, label)) return;

    const reqAt = new Date().toISOString();
    // Cosmetic log line on an internal, secret-authed path — migrated for
    // consistency with the single client-identity surface (2026-08-06 audit).
    console.log(
      `[Cron:${label}] [INPUT] POST ${path} at ${reqAt} ip=${resolveClientIdentity(req) || "?"}`
    );

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

export function registerCronRoutes(app: Express): void {
  mountJob(app, "/api/cron/vsin-odds", "vsin-odds", vsinRunner);
  mountJob(app, "/api/cron/scores", "scores", scoresRunner);
  mountJob(app, "/api/cron/mlb-cycle", "mlb-cycle", mlbCycleRunner);
  mountJob(app, "/api/cron/bet-grade", "bet-grade", betGradeRunner);
  mountJob(app, "/api/cron/bet-grade-sweep", "bet-grade-sweep", betGradeSweepRunner);

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

  // Stripe ↔ database drift detector (audit OPS-001).
  //
  // Webhook delivery is at-least-once but not guaranteed-once-forever: a revoke
  // lost during an outage, or an endpoint misconfiguration, leaves the database
  // silently disagreeing with Stripe — and nothing else in this system would
  // ever notice. This job is the safety net. It is strictly READ-ONLY: it lists
  // Stripe subscriptions, diffs them against app_users, and reports. It never
  // writes an entitlement, because auto-healing a drift you do not understand is
  // how one bad assumption becomes a mass revoke.
  //
  // Runs synchronously (like mlb-asg) so the workflow can print the drift table,
  // and returns 200 even when drift is found — drift is a finding to action, not
  // a failed job. Only an execution error is a non-2xx.
  app.post("/api/cron/stripe-reconcile", async (req: Request, res: Response) => {
    if (!requireCronSecret(req, res, "stripe-reconcile")) return;
    const maxPagesRaw = req.body?.maxPages ?? req.query?.maxPages;
    const maxPages = Number.isFinite(Number(maxPagesRaw)) && Number(maxPagesRaw) > 0
      ? Math.min(Number(maxPagesRaw), 50)
      : undefined;
    console.log(`[Cron:stripe-reconcile] [INPUT] POST /api/cron/stripe-reconcile maxPages=${maxPages ?? "default"} at ${new Date().toISOString()}`);
    try {
      const report = await reconcileStripeSubscriptions(maxPages ? { maxPages } : undefined);
      const summary = formatReconcileReport(report);
      console.log(`[Cron:stripe-reconcile] [OUTPUT]\n${summary}`);

      if (report.drift.length > 0) {
        void billingAlert("RECONCILE_DRIFT", {
          driftCount: report.drift.length,
          checkedStripeSubscriptions: report.checkedStripeSubscriptions,
          checkedDbUsers: report.checkedDbUsers,
          truncated: report.truncated,
          // Bounded sample only — the full report is in the job log.
          sample: report.drift.slice(0, 10).map((d) => ({ kind: d.kind, userId: d.userId, detail: d.detail })),
        });
      }

      console.log(`[Cron:stripe-reconcile] [VERIFY] ${report.drift.length === 0 ? "PASS — no drift" : `DRIFT — ${report.drift.length} row(s)`}`);
      res.status(200).json({ ok: true, ...report, summary });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Cron:stripe-reconcile] [ERROR] ${msg}`);
      void billingAlert("RECONCILE_DRIFT", { failed: true, detail: msg });
      res.status(500).json({ ok: false, error: msg });
    }
  });
  console.log(`[Cron] [OUTPUT] Registered POST /api/cron/stripe-reconcile (job=stripe-reconcile)`);

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
        "bet-grade": betGradeRunner.state,
        "bet-grade-sweep": betGradeSweepRunner.state,
      },
    });
  });
  console.log(`[Cron] [OUTPUT] Registered GET /api/cron/status`);
}
