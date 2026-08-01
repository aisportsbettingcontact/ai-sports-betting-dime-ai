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

  it("the dead mobile bet tracker screen is gone", () => {
    expect(existsSync(join(ROOT, "client/src/features/mobileNav/screens/MobileBetTracker.tsx"))).toBe(false);
    expect(read("client/src/features/mobileNav/index.ts")).not.toMatch(/MobileBetTracker/);
  });
});
