/**
 * stakeDenomination.test.ts — subscribers track in units, not dollars.
 *
 * WHY THE RULE EXISTS
 *
 * Unit size is a client-side setting (localStorage `bt_unitSize`), never
 * persisted or verified server-side. A dollar figure typed into the form is
 * therefore an unverifiable claim, and rendered as currency it reads as a real
 * bankroll — the raw material for touting a record, and it would attach
 * fabricated dollar totals to Dime's own surfaces.
 *
 * Units are self-relative: "+4.2u" says how well someone bet without asserting
 * a sum of money anyone could be misled by.
 *
 * The UI half is necessary but not sufficient — these procedures are reachable
 * by any authenticated subscriber, so the rule is enforced at the write
 * boundary and tested here.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decideStakeDenomination, isPrivilegedRole } from "./betTrackerCore";

const code = (p: string) =>
  readFileSync(join(__dirname, p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const router = code("routers/betTracker.ts");
const page = readFileSync(
  join(__dirname, "../client/src/pages/BetTracker.tsx"),
  "utf8"
);

describe("who may denominate in dollars", () => {
  it("owner and admin may", () => {
    for (const role of ["owner", "admin"]) {
      expect(decideStakeDenomination(role).unitsOnly, role).toBe(false);
    }
  });

  it("REGRESSION: every other role is units-only", () => {
    for (const role of [
      "user",
      "handicapper",
      "subscriber",
      "",
      "OWNER",
      "Admin",
    ]) {
      expect(decideStakeDenomination(role).unitsOnly, role).toBe(true);
    }
  });

  it("matches the privileged-role definition used everywhere else", () => {
    // One definition of "privileged", not a second list that can drift.
    for (const role of ["owner", "admin", "user", "handicapper"]) {
      expect(decideStakeDenomination(role).unitsOnly).toBe(
        !isPrivilegedRole(role)
      );
    }
  });

  it("an unknown role is units-only, not dollar-capable", () => {
    // Fail closed: a role added later must not silently inherit dollars.
    expect(decideStakeDenomination("some_new_role").unitsOnly).toBe(true);
  });

  it("the refusal explains itself and says dollars return", () => {
    const r = decideStakeDenomination("user");
    expect(r.reason).toMatch(/units/i);
    expect(r.reason).toMatch(/book-synced/i);
  });
});

describe("the rule is enforced at the write boundary, not just in the UI", () => {
  it("REGRESSION: create refuses a subscriber's bet with no riskUnits", () => {
    // A bet arriving without riskUnits is dollar-denominated by definition —
    // there is no unit basis to render it in.
    expect(router).toMatch(
      /assertUnitDenomination\(ctx\.appUser\.role, input\.riskUnits, "create"\)/
    );
  });

  it("REGRESSION: createParlay refuses one too", () => {
    expect(router).toMatch(
      /assertUnitDenomination\(ctx\.appUser\.role, input\.riskUnits, "createParlay"\)/
    );
  });

  it("the guard consults the shared rule rather than re-deciding", () => {
    const fn = router.slice(router.indexOf("function assertUnitDenomination"));
    expect(fn).toMatch(/decideStakeDenomination\(role\)/);
    expect(fn).toMatch(/if \(!rule\.unitsOnly\) return;/);
  });

  it("a zero or negative riskUnits does not satisfy it", () => {
    const fn = router.slice(router.indexOf("function assertUnitDenomination"));
    expect(fn).toMatch(/riskUnits != null && riskUnits > 0/);
  });

  it("the check runs BEFORE anything is written", () => {
    const proc = router.slice(
      router.indexOf("createParlay:"),
      router.indexOf("delete: appUserProcedure")
    );
    const guard = proc.indexOf("assertUnitDenomination");
    const insert = proc.indexOf("db.insert(trackedBets)");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(insert);
  });
});

describe("the client half", () => {
  it("REGRESSION: a subscriber is pinned to units regardless of localStorage", () => {
    // bt_stakeMode may already hold "$" from before this shipped. Reading the
    // raw value anywhere would resurrect dollar display for that user.
    expect(page).toMatch(
      /const effectiveStakeMode: StakeMode = isOwnerOrAdmin \? stakeMode : "U";/
    );
  });

  it("REGRESSION: nothing in the component body reads the raw stakeMode", () => {
    const body = page.slice(
      page.indexOf("const effectiveStakeMode: StakeMode =")
    );
    const raw = body
      .split("\n")
      .filter(l => /\bstakeMode\b/.test(l))
      .filter(l => !/effectiveStakeMode/.test(l))
      .filter(l => !/setStakeMode|bt_stakeMode/.test(l));
    expect(raw, `raw stakeMode reads:\n${raw.join("\n")}`).toEqual([]);
  });

  it("child components receive the EFFECTIVE mode", () => {
    // The prop keeps its name; the value passed is the pinned one.
    expect(page).toMatch(/stakeMode=\{effectiveStakeMode\}/);
    expect(page).not.toMatch(/stakeMode=\{stakeMode\}/);
  });

  it("REGRESSION: the dollar toggle is absent for subscribers, not merely disabled", () => {
    // A greyed-out dollar button still advertises a mode that is not returning
    // until bets are book-synced.
    expect(page).toMatch(/\{canUseDollars && \(/);
    expect(page).toMatch(/const canUseDollars = isOwnerOrAdmin;/);
  });

  it("the submit path converts using the effective mode", () => {
    // Otherwise a subscriber with "$" persisted would still send dollars.
    expect(page).toMatch(
      /effectiveStakeMode === "U" \? riskNumRaw \* unitSizeSafe : riskNumRaw/
    );
  });
});

describe("every write path resolves the stake quad through the core", () => {
  it("REGRESSION: update routes stake fields through resolveStakePatch", () => {
    // The de-sync this closes: update recomputed dollar toWin on an odds/risk
    // change and left riskUnits/toWinUnits frozen — a unit P&L paying the old
    // odds forever, and no denomination gate at all.
    expect(router).toMatch(/resolveStakePatch\(\{/);
    expect(router).not.toMatch(/patch\.toWin = String\(calcToWin/);
  });

  it("REGRESSION: update accepts unit restatements", () => {
    const updateBlock = router.slice(
      router.indexOf("update: appUserProcedure"),
      router.indexOf("createParlay:")
    );
    expect(updateBlock).toMatch(
      /riskUnits:\s*z\.number\(\)\.positive\(\)\.optional\(\)/
    );
    expect(updateBlock).toMatch(
      /toWinUnits:\s*z\.number\(\)\.positive\(\)\.optional\(\)/
    );
  });

  it("REGRESSION: straight create derives toWinUnits like createParlay does", () => {
    // Without this a subscriber straight bet stored riskUnits with a NULL
    // toWinUnits, and stats read it back mixed-basis: risk in stored units,
    // toWin in dollars ÷ the viewer's CURRENT unit size.
    const createBlock = router.slice(
      router.indexOf("create: appUserProcedure"),
      router.indexOf("update: appUserProcedure")
    );
    expect(createBlock).toMatch(
      /toWinUnits: resolveToWinUnits\(input\.riskUnits, input\.toWinUnits, input\.risk, toWin\)/
    );
  });

  it("REGRESSION (migration 0132): the parlay reprice keeps unit scale 4 via the shared law", () => {
    const grader = code("parlayGrader.ts");
    expect(grader).toMatch(/deriveToWinUnits\(/);
    expect(grader).not.toMatch(/toWinUnits[^\n]*\n[^\n]*toFixed\(2\)/);
  });

  it("REGRESSION: approved edit requests reconcile stake fields, never raw-write them", () => {
    // proposedChanges is caller-supplied JSON. odds/risk/toWin used to be
    // spread into the SQL update untyped and unreconciled.
    const block = router.slice(
      router.indexOf("reviewEditRequest"),
      router.indexOf("getLogs")
    );
    expect(block).toMatch(/resolveStakePatch\(/);
    expect(block).toMatch(/Number\.isFinite/);
    expect(block).not.toMatch(/const allowed = \["odds", "risk", "toWin"/);
  });
});
