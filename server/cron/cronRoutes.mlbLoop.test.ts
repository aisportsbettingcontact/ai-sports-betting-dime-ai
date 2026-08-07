/**
 * cronRoutes.mlbLoop.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Contract tests for the MLB learning-loop cron surface (audit M-208):
 * /api/cron/mlb-outcomes, /api/cron/mlb-closing-capture, /api/cron/mlb-backtest.
 *
 * These are SOURCE-CONTRACT tests: cronRoutes.ts wires Express to live DB
 * services, so importing it in vitest would drag the whole server graph in. The
 * assertions below read the module source and pin the properties that a future
 * edit could silently break — the same pattern ProjectionCard.test.ts uses for
 * CSS page-law guards.
 *
 * Each one exists because getting it wrong is silent, not loud.
 */
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const routes = fs.readFileSync(
  path.join(import.meta.dirname, "cronRoutes.ts"),
  "utf8"
);
const readme = fs.readFileSync(
  path.join(import.meta.dirname, "README.md"),
  "utf8"
);

describe("MLB learning-loop endpoints are mounted and auth-guarded", () => {
  it("mounts all three", () => {
    expect(routes).toContain('"/api/cron/mlb-outcomes"');
    expect(routes).toContain('"/api/cron/mlb-closing-capture"');
    expect(routes).toContain('"/api/cron/mlb-backtest"');
  });

  it("routes every mount through a secret-guarded helper", () => {
    // Both helpers call requireCronSecret as their first statement; nothing may
    // be mounted with a bare app.post that skips it.
    for (const helper of ["function mountJob(", "function mountDateJob("]) {
      const body = routes.slice(routes.indexOf(helper));
      expect(body.slice(0, 400)).toContain("requireCronSecret");
    }
  });

  it("appends to the status roster without dropping the existing jobs", () => {
    // The exact hunk where a mechanical cherry-pick silently drops main's two
    // grading jobs from observability.
    for (const job of [
      '"vsin-odds": vsinRunner.state',
      "scores: scoresRunner.state",
      '"mlb-cycle": mlbCycleRunner.state',
      '"bet-grade": betGradeRunner.state',
      '"bet-grade-sweep": betGradeSweepRunner.state',
      '"mlb-outcomes": mlbOutcomesRunner.state',
      '"mlb-closing-capture": mlbClosingCaptureRunner.state',
      '"mlb-backtest": mlbBacktestRunner.state',
    ]) {
      expect(routes, `status roster missing ${job}`).toContain(job);
    }
  });
});

describe("mlb-backtest stays decoupled from the un-refit K constants", () => {
  // If runKProps ever flips to true here, this endpoint starts grading kProj
  // against K_CALIBRATION_FACTOR_OVER/UNDER — still the pre-M-204 literals —
  // and pollutes the evaluation set the walk-forward re-fit is judged on.
  it("passes runKProps: false", () => {
    const runner = routes.slice(
      routes.indexOf('new CronJobRunner("mlb-backtest"')
    );
    expect(runner.slice(0, 900)).toContain("runKProps: false");
    expect(runner.slice(0, 900)).not.toContain("runKProps: true");
  });

  it("enrolls only unenrolled games — self-heal, not re-grade", () => {
    const runner = routes.slice(
      routes.indexOf('new CronJobRunner("mlb-backtest"')
    );
    expect(runner.slice(0, 900)).toContain("onlyUnenrolled: true");
  });

  it("documents the backfill hold in the README", () => {
    expect(readme).toMatch(
      /BULK BACKFILL until after the K walk-forward re-fit/i
    );
  });
});

describe("fail-loud, not silently green (OBS-0002 class)", () => {
  it("mlb-backtest throws when every enrollment failed", () => {
    expect(routes).toContain("all ${errors} backtest enrollments failed");
  });

  it("treats zero unenrolled games as success, not failure", () => {
    // `processed === 0 && errors > 0` — an empty self-heal window is the normal
    // steady state and must not page anyone.
    expect(routes).toContain("processed === 0 && errors > 0");
  });

  it("mlb-outcomes throws only when EVERY date failed", () => {
    expect(routes).toContain("failures.length === dates.length");
  });
});

describe("date handling", () => {
  it("rejects a malformed ?date= with 400 instead of silently using the default", () => {
    expect(routes).toContain('"invalid-date"');
    expect(routes).toContain('expected: "YYYY-MM-DD"');
  });

  it("uses PT for outcomes and ET for backtest — the zones are not interchangeable", () => {
    // games.gameDate is a PT calendar date, so a late West Coast final belongs to
    // the PT day even after UTC has rolled over.
    expect(routes).toContain('lastNDates(2, "America/Los_Angeles")');
    expect(routes).toContain('lastNDates(3, "America/New_York")');
  });

  it("stashes the date BEFORE trigger(), or the runner reads a stale window", () => {
    const helper = routes.slice(routes.indexOf("function mountDateJob("));
    const setDateAt = helper.indexOf("setDate(");
    const triggerAt = helper.indexOf("runner.trigger()");
    expect(setDateAt).toBeGreaterThan(-1);
    expect(triggerAt).toBeGreaterThan(setDateAt);
  });
});
