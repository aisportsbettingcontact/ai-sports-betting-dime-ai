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
 * DELIBERATELY NOT wired here: MLB model sync. runMlbModelForDate() spawns
 * /usr/bin/python3 (400k Monte-Carlo sims) which fails on Railway with
 * `spawn /usr/bin/python3 ENOENT`. Curling a Railway endpoint for it would just
 * error. It needs Python-in-the-runner (run the model inside the Actions job with
 * DB write-back), which is a separate follow-up — not an HTTP curl.
 */

import type { Express, Request, Response } from "express";
import { requireCronSecret } from "./cronAuth";
import { CronJobRunner } from "./cronRunner";
import { runVsinRefresh, refreshAllScoresNow, runMlbCycleOnce } from "../vsinAutoRefresh";

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

export function registerCronRoutes(app: Express): void {
  mountJob(app, "/api/cron/vsin-odds", "vsin-odds", vsinRunner);
  mountJob(app, "/api/cron/scores", "scores", scoresRunner);
  mountJob(app, "/api/cron/mlb-cycle", "mlb-cycle", mlbCycleRunner);

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
      },
    });
  });
  console.log(`[Cron] [OUTPUT] Registered GET /api/cron/status`);
}
