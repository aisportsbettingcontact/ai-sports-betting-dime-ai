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
 * SCOPE: WIRING ONLY. The job LOGIC (windows, aggregation, fail-loud rules,
 * date validation) is executed and asserted in mlbLoopJobs.test.ts — text
 * matching proves what code says, never what it does, and the patch-coverage
 * gate is right to refuse it as coverage. What remains here are the facts that
 * genuinely cannot be executed without standing up Express and the DB graph.
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

  it("mountJob still guards with requireCronSecret", () => {
    // mountDateJob's guard is asserted by EXECUTION in mountDateJob.test.ts
    // ("refuses an unauthenticated request"); this covers the sibling helper,
    // which stays inline here and is not otherwise importable.
    const body = routes.slice(routes.indexOf("function mountJob("));
    expect(body.slice(0, 400)).toContain("requireCronSecret");
  });

  it("mounts nothing with a bare app.post that bypasses a helper", () => {
    for (const p of [
      "/api/cron/mlb-outcomes",
      "/api/cron/mlb-closing-capture",
      "/api/cron/mlb-backtest",
    ]) {
      expect(routes).not.toContain('app.post("' + p + '"');
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
  // Asserted on the WHOLE file, not a slice offset: the previous version keyed
  // off a substring position and broke the moment the runner construction went
  // multi-line, which is exactly how brittle text assertions earn their
  // reputation. The behavioural suite mocks runForDate, so it cannot see which
  // options the real wiring passes — this is the only guard on that, and it
  // matters: flipping runKProps to true would grade kProj against
  // K_CALIBRATION_FACTOR_OVER/UNDER (still the pre-M-204 literals) and pollute
  // the evaluation set the walk-forward re-fit is judged on.
  it("wires runKProps: false and never true", () => {
    expect(routes).toContain("runKProps: false");
    expect(routes).not.toContain("runKProps: true");
  });

  it("wires onlyUnenrolled: true — self-heal, not re-grade", () => {
    expect(routes).toContain("onlyUnenrolled: true");
  });

  it("documents the backfill hold in the README", () => {
    expect(readme).toMatch(
      /BULK BACKFILL until after the K walk-forward re-fit/i
    );
  });
});
