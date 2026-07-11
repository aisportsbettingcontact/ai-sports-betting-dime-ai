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
 *   - POST /api/cron/vsin-odds        → runVsinRefresh()      (NBA/NHL/MLB VSiN + AN odds)
 *   - POST /api/cron/scores           → refreshAllScoresNow()  (live score refresh)
 *   - POST /api/cron/mlb-cycle        → runMlbCycleOnce()      (MLB lineups/K-props/backtest writes)
 *   - POST /api/cron/mlb-daily-seeds  → pitcher stats + bullpen stats + rolling-5 + team batting splits
 *   - POST /api/cron/mlb-weekly-seeds → park factors + umpire modifiers
 *   - GET  /api/cron/status           → run-lock state for all jobs (observability)
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

// ─── MLB stat seeders (daily + weekly batches) ───────────────────────────────
// These previously ran ONLY via in-process setIntervals inside startVsinAutoRefresh
// (server/vsinAutoRefresh.ts) — daily for pitcher/bullpen/rolling-5/batting-splits,
// weekly for park factors/umpire modifiers. With DISABLE_BACKGROUND_JOBS=1 on the
// Railway web replica those intervals never start, so post-Manus-cutover these
// endpoints are the ONLY trigger. Same dynamic-import style as vsinAutoRefresh so
// module load order is unchanged (the seed modules pull in DB + MLB Stats API code).

/** One seeder inside a batch: label + dynamic-import runner returning a summary. */
interface SeederStep {
  label: string;
  run: () => Promise<Record<string, number>>;
}

/**
 * Run seeders sequentially (the in-process schedulers never overlapped them, and
 * sequential keeps MLB Stats API pressure flat). Each seeder gets its own
 * try/catch so one failure never blocks the rest; per-seeder ok/error is logged,
 * and if ANY seeder failed the batch throws at the end so CronJobRunner records
 * ok:false — visible via GET /api/cron/status and the Actions workflow logs.
 */
async function runSeederBatch(batchLabel: string, steps: SeederStep[]): Promise<void> {
  const outcomes: { label: string; ok: boolean; error?: string; summary?: Record<string, number> }[] = [];
  for (const step of steps) {
    try {
      const summary = await step.run();
      outcomes.push({ label: step.label, ok: true, summary });
      console.log(`[Cron:${batchLabel}] [OUTPUT] ${step.label} ok ${JSON.stringify(summary)}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      outcomes.push({ label: step.label, ok: false, error: message });
      console.warn(`[Cron:${batchLabel}] [OUTPUT] ${step.label} FAILED: ${message}`);
    }
  }
  const failed = outcomes.filter((o) => !o.ok);
  console.log(
    `[Cron:${batchLabel}] [VERIFY] ${outcomes.length - failed.length}/${outcomes.length} seeders ok` +
    (failed.length ? ` — failed: ${failed.map((f) => f.label).join(", ")}` : "")
  );
  if (failed.length > 0) {
    throw new Error(
      `${failed.length}/${outcomes.length} seeders failed: ` +
      failed.map((f) => `${f.label} (${f.error})`).join("; ")
    );
  }
}

// Daily batch — pitcher stats, bullpen stats, rolling-5 blend, team batting splits.
const mlbDailySeedsRunner = new CronJobRunner("mlb-daily-seeds", async () => {
  await runSeederBatch("mlb-daily-seeds", [
    {
      label: "pitcher-stats",
      run: async () => {
        const { seedPitcherStats } = await import("../seedPitcherStats");
        return seedPitcherStats();
      },
    },
    {
      label: "bullpen-stats",
      run: async () => {
        const { seedBullpenStats } = await import("../seedBullpenStats");
        return seedBullpenStats();
      },
    },
    {
      label: "pitcher-rolling5",
      run: async () => {
        const { seedPitcherRolling5 } = await import("../seedPitcherRolling5");
        return seedPitcherRolling5();
      },
    },
    {
      label: "team-batting-splits",
      run: async () => {
        const { seedTeamBattingSplits } = await import("../seedTeamBattingSplits");
        return seedTeamBattingSplits();
      },
    },
  ]);
});

// Weekly batch — slow-moving data: park factors (3yr rolling) + umpire modifiers.
const mlbWeeklySeedsRunner = new CronJobRunner("mlb-weekly-seeds", async () => {
  await runSeederBatch("mlb-weekly-seeds", [
    {
      label: "park-factors",
      run: async () => {
        const { seedParkFactors } = await import("../seedParkFactors");
        return seedParkFactors();
      },
    },
    {
      label: "umpire-modifiers",
      run: async () => {
        const { seedUmpireModifiers } = await import("../seedUmpireModifiers");
        return seedUmpireModifiers();
      },
    },
  ]);
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
  mountJob(app, "/api/cron/mlb-daily-seeds", "mlb-daily-seeds", mlbDailySeedsRunner);
  mountJob(app, "/api/cron/mlb-weekly-seeds", "mlb-weekly-seeds", mlbWeeklySeedsRunner);

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
        "mlb-daily-seeds": mlbDailySeedsRunner.state,
        "mlb-weekly-seeds": mlbWeeklySeedsRunner.state,
      },
    });
  });
  console.log(`[Cron] [OUTPUT] Registered GET /api/cron/status`);
}
