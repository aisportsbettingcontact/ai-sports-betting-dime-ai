/**
 * betTrackerContract.test.ts — structural guarantees about the Bet Tracker.
 *
 * These read source text rather than call functions. They exist because the
 * properties they protect are invisible to a type checker and were each the
 * cause of a real defect:
 *
 *   - A procedure left on `handicapperProcedure` silently locks regular users
 *     out of their own bets (and skips the account-expiry check).
 *   - A second copy of the stats aggregation drifts from the first.
 *   - A second copy of the grading loop drifts from the first.
 *   - Invalidating the actor's stats cache instead of the bet OWNER's leaves the
 *     owner looking at stale numbers.
 *   - Grading with no cron path dies silently under DISABLE_BACKGROUND_JOBS.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const read = (p: string): string => readFileSync(join(ROOT, p), "utf8");

const router = read("server/routers/betTracker.ts");
const scheduler = read("server/betAutoGradeScheduler.ts");
const cronRoutes = read("server/cron/cronRoutes.ts");
const clientPage = read("client/src/pages/BetTracker.tsx");

describe("access model", () => {
  it("every betTracker procedure runs on appUserProcedure", () => {
    const procedures = router.match(/^ {2}(\w+): (\w+Procedure)$/gm) ?? [];
    expect(procedures.length).toBeGreaterThan(8);
    const wrong = procedures.filter(p => !p.includes("appUserProcedure"));
    expect(wrong, `procedures not on appUserProcedure: ${wrong.join(", ")}`).toEqual([]);
  });

  it("no procedure imports handicapperProcedure any more", () => {
    expect(router).not.toMatch(/import\s+\{[^}]*handicapperProcedure/);
  });

  it("visibility is resolved in exactly one place", () => {
    // Any hand-rolled `role !== "owner" && role !== "admin"` check is a second
    // implementation of the rule and can drift from resolveViewUserId.
    expect(router).not.toMatch(/role !== "owner" && role !== "admin"/);
    expect(router).toMatch(/function resolveScope/);
  });

  it("every read that accepts targetUserId routes it through resolveScope", () => {
    const targetUserIdReads = (router.match(/targetUserId: z\.number\(\)/g) ?? []).length;
    const scopeCalls = (router.match(/resolveScope\(ctx, input/g) ?? []).length;
    expect(scopeCalls).toBeGreaterThanOrEqual(targetUserIdReads);
  });

  it("owner/admin-only procedures assert privileged access", () => {
    for (const proc of ["listHandicappers", "getLogs", "reviewEditRequest", "autoGradeAll"]) {
      const idx = router.indexOf(`  ${proc}: appUserProcedure`);
      expect(idx, `${proc} missing`).toBeGreaterThan(-1);
      const body = router.slice(idx, idx + 2000);
      expect(body, `${proc} must gate on decidePrivilegedAccess`).toMatch(/decidePrivilegedAccess/);
    }
  });
});

describe("single implementation", () => {
  it("the dead duplicate read procedures are gone", () => {
    for (const dead of ["  list: ", "  getStats: ", "  listWithStats: "]) {
      expect(router.includes(dead), `${dead.trim()} should be deleted`).toBe(false);
    }
  });

  it("the router contains no aggregation of its own", () => {
    // Breakdown assembly belongs to betTrackerCore.aggregateStats alone.
    expect(router).not.toMatch(/const byTypeMap\b/);
    expect(router).not.toMatch(/finalizeBreakdown/);
    expect(router).toMatch(/aggregateStats\(/);
  });

  it("the router contains no grading loop of its own", () => {
    expect(router).not.toMatch(/gradeTrackedBet\(/);
    expect(router).toMatch(/gradePendingForUser|gradeAllPendingForDate/);
  });

  it("the stats query is projected, not SELECT *", () => {
    expect(router).toMatch(/STAT_COLUMNS/);
    expect(router).toMatch(/db\.select\(STAT_COLUMNS\)/);
  });
});

describe("cache invalidation targets the bet owner", () => {
  for (const proc of ["update", "delete"]) {
    it(`${proc} invalidates existing.userId, not the actor`, () => {
      const idx = router.indexOf(`  ${proc}: appUserProcedure`);
      const end = router.indexOf("\n  /**", idx);
      const body = router.slice(idx, end === -1 ? router.length : end);
      expect(body, `${proc} must invalidate the bet owner's cache`)
        .toMatch(/invalidateStatsCacheForUser\(existing\.userId\)/);
    });
  }

  it("the cache key is built from the resolved user id", () => {
    expect(router).toMatch(/buildStatsCacheKey\(userId,/);
  });
});

describe("admin reach and result integrity", () => {
  it("the account picker is driven by bet ownership, not by role", () => {
    // Filtering to owner/admin/handicapper left four role=user accounts holding
    // 17 bets unreachable — admins could see 39% of tracked bets and none
    // belonging to a real user.
    const idx = router.indexOf("listHandicappers: appUserProcedure");
    const body = router.slice(idx, idx + 1400);
    expect(body).toMatch(/innerJoin\(trackedBets/);
    expect(body).not.toMatch(/inArray\(appUsers\.role/);
  });

  it("a result change is gated and logged", () => {
    const idx = router.indexOf("  update: appUserProcedure");
    const end = router.indexOf("\n  /**", idx);
    const body = router.slice(idx, end === -1 ? router.length : end);
    expect(body).toMatch(/decideResultOverride/);
    expect(body).toMatch(/RESULT_OVERRIDE/);
    // Only a genuine change is an override — resending the same value is not.
    expect(body).toMatch(/input\.result !== existing\.result/);
  });
});

describe("grading concurrency", () => {
  it("both cron entry points hold the same process mutex as the pollers", () => {
    // runBetGradeCycle used to call gradeAllPendingForDate directly while
    // CronJobRunner held only its own lock, so a GitHub-triggered grade and the
    // 5-minute in-process poll could grade the same rows concurrently.
    expect(scheduler).toMatch(/function withGradingLock/);
    expect(scheduler).toMatch(/withGradingLock\("runBetGradeCycle"/);
    expect(scheduler).toMatch(/withGradingLock\("runBetGradeSweep"/);
    expect(cronRoutes).toMatch(/runBetGradeSweep\(/);
    expect(cronRoutes).not.toMatch(/gradeAllPendingAllDates\(/);
  });

  it("the nightly in-process sweep does NOT double-take the lock", () => {
    // It sets isGrading itself before calling gradeAllPendingAllDates; routing
    // it through withGradingLock as well would make it skip itself every night.
    const idx = scheduler.indexOf("async function runNightlySweep");
    const body = scheduler.slice(idx, idx + 1200);
    expect(body).toMatch(/gradeAllPendingAllDates\(/);
    expect(body).not.toMatch(/withGradingLock/);
  });
});

describe("this PR carries no schema change", () => {
  // The two hot-path indexes (idx_tb_result_date, idx_tb_user_game) were pulled
  // out deliberately. The migration pipeline cannot currently deliver them:
  // `drizzle-kit generate` silently no-ops on a malformed meta file, and the
  // reconciler has six pending migrations whose unguarded
  // `ALTER TABLE app_users ADD ...` statements target columns that already exist
  // in production. See the follow-up issue. Nothing here depends on those
  // indexes for correctness — they are pure query optimisation.
  it("leaves tracked_bets indexes untouched", () => {
    const schema = read("drizzle/schema.ts");
    expect(schema).not.toMatch(/idx_tb_result_date/);
    expect(schema).not.toMatch(/idx_tb_user_game/);
  });
});

describe("grading has a cron path", () => {
  it("bet-grade endpoints are mounted", () => {
    expect(cronRoutes).toMatch(/\/api\/cron\/bet-grade["']/);
    expect(cronRoutes).toMatch(/\/api\/cron\/bet-grade-sweep["']/);
  });

  it("they run under the single-flight run-lock like every other cron job", () => {
    expect(cronRoutes).toMatch(/new CronJobRunner\("bet-grade"/);
    expect(cronRoutes).toMatch(/new CronJobRunner\("bet-grade-sweep"/);
  });

  it("a workflow exists to fire them", () => {
    const wf = join(ROOT, ".github/workflows/cron-bet-grade.yml");
    expect(existsSync(wf)).toBe(true);
    const body = readFileSync(wf, "utf8");
    expect(body).toMatch(/api\/cron\/bet-grade/);
    expect(body).toMatch(/CRON_SECRET/);
  });

  it("the nightly sweep window is wide enough to survive a busy mutex", () => {
    // A 3-minute window with a 1-minute tick meant one slow polling run could
    // consume every attempt and the night's sweep was lost silently.
    expect(scheduler).toMatch(/export function nightlySweepTarget/);
    expect(scheduler).toMatch(/lastSweptNight/);
  });
});

describe("client", () => {
  it("the tracker is open to every authenticated user, not owner-only", () => {
    expect(clientPage).toMatch(/const canAccess = !!appUser;/);
    expect(clientPage).not.toMatch(/const canAccess = role === "owner"/);
  });

  it("invalidation refreshes the calendar alongside the bet list", () => {
    const idx = clientPage.indexOf("const invalidate = useCallback");
    const body = clientPage.slice(idx, idx + 600);
    expect(body).toMatch(/listWithStatsPaginated\.invalidate/);
    expect(body).toMatch(/getCalendarData\.invalidate/);
  });

  it("no client code references the deleted procedures", () => {
    for (const dead of ["betTracker.listWithStats.", "betTracker.getStats", "betTracker.list."]) {
      expect(clientPage.includes(dead), `${dead} should be gone`).toBe(false);
    }
  });

  it("the auto-grade poll does not run while viewing another user's tracker", () => {
    // autoGrade is self-scoped server-side, so firing it here graded the
    // viewer's own bets while showing progress over someone else's rows.
    expect(clientPage).toMatch(/if \(isViewingOtherUser\) return;/);
  });

  it("REGRESSION: edit/delete route by the handicapper rule, not by owner/admin", () => {
    // Opening the page to subscribers without changing these two gates swept
    // every regular user into the handicapper edit-request queue — a queue only
    // owner/admin can see. Production proof (2026-08-03): perky (role=user)
    // filed DELETE request 120001, it sat unanswerable, and the user worked
    // around it by hand-marking bet 390003 PUSH.
    expect(clientPage).toMatch(/const mustRequestChanges = role === "handicapper";/);
    expect(clientPage).toMatch(/setDeleteIsRequest\(mustRequestChanges\)/);
    expect(clientPage).toMatch(/setEditIsRequest\(mustRequestChanges\)/);
    expect(clientPage).not.toMatch(/setDeleteIsRequest\(!isOwnerOrAdmin\)/);
    expect(clientPage).not.toMatch(/setEditIsRequest\(!isOwnerOrAdmin\)/);
  });

  it("the direct-edit map uses the same predicate as the dialogs", () => {
    // One rule, one name — the previous split let the card affordance and the
    // dialog disagree about the same bet.
    const idx = clientPage.indexOf("const canDirectEditMap");
    const body = clientPage.slice(idx, idx + 700);
    expect(body).toMatch(/mustRequestChanges/);
    expect(body).not.toMatch(/role === "handicapper"/);
  });

  it("the dead mobile bet tracker screen is gone", () => {
    expect(existsSync(join(ROOT, "client/src/features/mobileNav/screens/MobileBetTracker.tsx"))).toBe(false);
    expect(read("client/src/features/mobileNav/index.ts")).not.toMatch(/MobileBetTracker/);
  });
});
