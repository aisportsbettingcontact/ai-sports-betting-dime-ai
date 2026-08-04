/**
 * parlayCoverage.test.ts — the grading-coverage gaps found auditing PR #335.
 *
 * PR #335 excluded parlay parents from the three straight-bet PENDING
 * selections, which was correct — a ticket is not a straight bet. What it did
 * not do was give any of those paths a LEG equivalent. The exclusion shipped;
 * the counterpart did not. The result was a ticket that could only ever settle
 * inside a two-day window, from one call site, with no alarm if it never did.
 *
 * Six independent audit lenses converged on this cluster. These tests pin the
 * fixes so the counterpart cannot go missing again.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(__dirname, p), "utf8");
/** Comments stripped, so prose describing a fix cannot satisfy an assertion. */
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const grader = code("parlayGrader.ts");
const sched = code("betAutoGradeScheduler.ts");
const router = code("routers/betTracker.ts");

describe("legs have every recovery path straight bets have", () => {
  it("REGRESSION: an all-dates leg sweep exists", () => {
    // Without it, a leg outside today/yesterday — an outage, a restart across
    // midnight, a backdated ticket — is never looked at again and its ticket
    // stays PENDING forever.
    expect(grader).toMatch(/export async function gradeAllParlaysAllDates/);
    const fn = grader.slice(grader.indexOf("gradeAllParlaysAllDates"));
    // Selects open legs with NO date predicate.
    expect(fn).toMatch(/eq\(trackedBetLegs\.result,\s*"PENDING"\)/);
    const selectBlock = fn.slice(0, fn.indexOf("summary.legsExamined"));
    expect(selectBlock).not.toMatch(/trackedBetLegs\.gameDate/);
  });

  it("REGRESSION: the all-dates sweep is wired into gradeAllPendingAllDates", () => {
    expect(sched).toMatch(/gradeAllParlaysAllDates\(/);
  });

  it("REGRESSION: it runs BEFORE the zero-straight-bets early return", () => {
    // A slate with no pending straight bets can still hold a stranded leg.
    const fn = sched.slice(sched.indexOf("async function gradeAllPendingAllDates"));
    const sweepPos = fn.indexOf("gradeAllParlaysAllDates");
    const returnPos = fn.indexOf("0 PENDING bets");
    expect(sweepPos).toBeGreaterThan(-1);
    expect(sweepPos).toBeLessThan(returnPos);
  });

  it("REGRESSION: it re-folds every still-PENDING ticket, not only touched ones", () => {
    // A ticket whose legs are ALL terminal only settles as a side effect of a
    // leg being graded. One failed settleTickets call would strand it forever.
    const fn = grader.slice(grader.indexOf("gradeAllParlaysAllDates"));
    expect(fn).toMatch(/eq\(trackedBets\.result,\s*"PENDING"\)[\s\S]{0,80}gt\(trackedBets\.legCount,\s*0\)/);
  });

  it("REGRESSION: the interactive path settles a user's parlays", () => {
    // gradePendingForUser excludes tickets (legCount=0) and did nothing for
    // legs, so the "grade my bets" button could never settle a parlay.
    expect(grader).toMatch(/export async function gradeParlaysForUser/);
    expect(sched).toMatch(/gradeParlaysForUser\(userId,/);
  });

  it("the interactive parlay path runs before its own early return too", () => {
    const fn = sched.slice(sched.indexOf("export async function gradePendingForUser"));
    const parlayPos = fn.indexOf("gradeParlaysForUser");
    const returnPos = fn.indexOf("if (pending.length === 0) return emptySummary(scope)");
    expect(parlayPos).toBeGreaterThan(-1);
    expect(parlayPos).toBeLessThan(returnPos);
  });

  it("every leg entry point is failure-isolated from straight-bet grading", () => {
    for (const call of ["gradeAllParlaysAllDates", "gradeParlaysForUser", "gradeParlaysForDate"]) {
      const i = sched.indexOf(`await ${call}(`);
      expect(i, `${call} is called`).toBeGreaterThan(-1);
      // A try opens before the call and a catch follows it.
      const before = sched.slice(Math.max(0, i - 400), i);
      const after = sched.slice(i, i + 700);
      expect(before, `${call} is inside a try`).toMatch(/try\s*\{/);
      expect(after, `${call} has a catch`).toMatch(/catch/);
    }
  });
});

describe("a stranded leg is alarmed, not silent", () => {
  it("REGRESSION: stuck LEGS are detected", () => {
    // checkStuckBets queries tracked_bets, which cannot see this: a ticket is
    // dated by its LAST leg, so a leg stranded on an early date sits inside
    // the parent's window for the life of the ticket.
    expect(grader).toMatch(/export async function findStuckLegs/);
    expect(sched).toMatch(/findStuckLegs\(/);
  });

  it("stuck legs raise a real alarm, not just a log line", () => {
    const block = sched.slice(sched.indexOf("findStuckLegs("));
    expect(block).toMatch(/gradingAlert\(\s*"STUCK_BETS"/);
  });

  it("REGRESSION: parlay grading errors reach gradingAlert", () => {
    // The ParlayGradeSummary was discarded, so a sweep could raise errors on
    // every cycle in silence while straight-bet errors alarmed normally.
    const cycle = sched.slice(sched.indexOf("runBetGradeCycle"));
    expect(cycle).toMatch(/describeGradingErrors\(/);
    expect(cycle).toMatch(/gradingAlert\(\s*"GRADING_ERRORS"/);
  });

  it("a thrown sweep also alarms rather than only logging", () => {
    const cycle = sched.slice(sched.indexOf("runBetGradeCycle"));
    expect(cycle).toMatch(/parlay sweep threw|Parlay leg sweep threw/i);
  });
});

describe("settlement never destroys a human decision", () => {
  it("REGRESSION: a settled ticket is never walked back to PENDING", () => {
    // An owner may hand-set a result the grader cannot reach. A sweep that
    // reverted it would undo the correction every 30 minutes, forever.
    expect(grader).toMatch(/settlement\.result === "PENDING" && ticket\.result !== "PENDING"/);
  });

  it("REGRESSION: editing a parlay's price moves originalOdds with it", () => {
    // originalOdds is the basis every reprice divides from. Moving odds alone
    // leaves the grader dividing from the OLD price and silently reverting.
    expect(router).toMatch(/if \(existing\.legCount > 0\) patch\.originalOdds = input\.odds;/);
  });

  it("REGRESSION: toWinUnits is cleared rather than left stale when unrecomputable", () => {
    // A stale unit figure keeps paying the ORIGINAL odds in unit P&L. Null
    // makes aggregateStats fall back to dollars/unitSize, which is correct.
    expect(grader).toMatch(/patch\.toWinUnits =[\s\S]{0,160}: null;/);
  });
});

describe("every path that deletes a ticket deletes its legs", () => {
  it("REGRESSION: the approved-DELETE request path cascades", () => {
    // The `delete` mutation cascaded; this second path to the same outcome did
    // not. An orphaned leg stays PENDING, so the sweep keeps grading it and
    // re-folding a ticket that no longer exists.
    const block = router.slice(router.indexOf("reviewEditRequest:"));
    const legPos = block.indexOf("delete(trackedBetLegs)");
    const betPos = block.indexOf("delete(trackedBets)");
    expect(legPos).toBeGreaterThan(-1);
    expect(legPos).toBeLessThan(betPos);
  });

  it("both delete paths cascade", () => {
    const cascades = (router.match(/delete\(trackedBetLegs\)/g) ?? []).length;
    // delete mutation, reviewEditRequest, and the createParlay rollback.
    expect(cascades).toBeGreaterThanOrEqual(3);
  });
});

describe("createParlay cannot leave a ticket that can never settle", () => {
  it("REGRESSION: a failed leg insert rolls the ticket back", () => {
    // legCount=N with zero legs can never settle: the grader finds no legs and
    // leaves it PENDING forever — visible to the user, counted as open risk.
    const proc = router.slice(router.indexOf("createParlay:"), router.indexOf("delete: appUserProcedure"));
    expect(proc).toMatch(/catch[\s\S]{0,300}delete\(trackedBets\)/);
    expect(proc).toMatch(/Nothing was saved/);
  });

  it("REGRESSION: idempotency compares legs, not just ticket shape", () => {
    // Two different tickets can share (legCount, odds, risk) — the same stake
    // at the same price on a different set of games. A shape-only guard would
    // discard the second and hand back the first.
    const proc = router.slice(router.indexOf("createParlay:"), router.indexOf("delete: appUserProcedure"));
    expect(proc).toMatch(/fingerprint\(/);
    expect(proc).toMatch(/anGameId/);
  });
});
