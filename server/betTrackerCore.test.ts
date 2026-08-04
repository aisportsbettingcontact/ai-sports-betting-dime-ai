/**
 * betTrackerCore.test.ts — the rules that decide who sees whose money.
 *
 * Every function under test is pure, so this suite needs no database, no tRPC
 * context and no network. That is the point: before the 2026-07-31 refactor the
 * permission matrix, the unit-bucket fallback, the RL line convention and the
 * stats aggregation lived inline in a 2,279-line router with zero test coverage,
 * and three copies of the aggregation had silently drifted apart.
 */

import { describe, it, expect } from "vitest";
import {
  aggregateStats,
  calcToWin,
  calcUnitBucket,
  decideBetMutation,
  decidePrivilegedAccess,
  decideResultOverride,
  decodeCursor,
  derivePickLabel,
  effectiveLine,
  encodeCursor,
  marketRequiresLine,
  resolveLineForUpdate,
  resolveViewUserId,
  toUnits,
  UNIT_BUCKET_ORDER,
  type Market,
  type PickSide,
  type Role,
  type StatRow,
} from "./betTrackerCore";

// ─── 1. Visibility matrix ─────────────────────────────────────────────────────

describe("resolveViewUserId — every role × every target", () => {
  const ROLES: Role[] = ["owner", "admin", "handicapper", "user"];
  const SELF = 10;
  const OTHER = 20;

  it("returns own id for every role when no target is supplied", () => {
    for (const role of ROLES) {
      const res = resolveViewUserId({ role, viewerId: SELF });
      expect(res, `role=${role}`).toEqual({ ok: true, userId: SELF, scope: "self" });
    }
  });

  it("returns own id for every role when the target IS self", () => {
    for (const role of ROLES) {
      const res = resolveViewUserId({ role, viewerId: SELF, targetUserId: SELF });
      expect(res, `role=${role}`).toEqual({ ok: true, userId: SELF, scope: "self" });
    }
  });

  it("lets owner and admin read another user", () => {
    for (const role of ["owner", "admin"] as Role[]) {
      const res = resolveViewUserId({ role, viewerId: SELF, targetUserId: OTHER });
      expect(res, `role=${role}`).toEqual({ ok: true, userId: OTHER, scope: "other" });
    }
  });

  it("REFUSES to widen scope for handicapper and user — the core isolation guarantee", () => {
    for (const role of ["handicapper", "user"] as Role[]) {
      const res = resolveViewUserId({ role, viewerId: SELF, targetUserId: OTHER });
      expect(res.ok, `role=${role} must not read user ${OTHER}`).toBe(false);
      if (!res.ok) expect(res.code).toBe("FORBIDDEN");
    }
  });

  it("never returns a userId other than the viewer's for a non-privileged role", () => {
    // Property check across a spread of ids: an unprivileged caller can only
    // ever be scoped to itself, whatever it asks for.
    for (const role of ["handicapper", "user"] as Role[]) {
      for (const target of [1, 2, 999, 123456]) {
        const res = resolveViewUserId({ role, viewerId: SELF, targetUserId: target });
        if (res.ok) expect(res.userId).toBe(SELF);
      }
    }
  });

  it("treats null and undefined targets as self", () => {
    expect(resolveViewUserId({ role: "user", viewerId: SELF, targetUserId: null }).ok).toBe(true);
    expect(resolveViewUserId({ role: "user", viewerId: SELF, targetUserId: undefined }).ok).toBe(true);
  });

  it("rejects an unknown role rather than defaulting it open", () => {
    const res = resolveViewUserId({ role: "superuser", viewerId: SELF, targetUserId: OTHER });
    expect(res.ok).toBe(false);
  });
});

describe("decideResultOverride — hand-written results are owner/admin only", () => {
  it("permits owner and admin", () => {
    expect(decideResultOverride("owner").allowed).toBe(true);
    expect(decideResultOverride("admin").allowed).toBe(true);
  });

  it("REGRESSION: refuses a regular user and a handicapper", () => {
    // Production evidence (2026-08-03): five rows carried a W/L/PUSH with NULL
    // scores, and bet 390003 was hand-marked PUSH 2h11m BEFORE first pitch. The
    // grading engine always persists scores with a result, so only a manual
    // override can produce that — and it let a user rewrite their own record.
    for (const role of ["user", "handicapper", ""]) {
      const d = decideResultOverride(role);
      expect(d.allowed, `role=${role}`).toBe(false);
      if (!d.allowed) expect(d.message).toMatch(/grading engine/i);
    }
  });

  it("points the blocked user at the action they actually want", () => {
    const d = decideResultOverride("user");
    if (!d.allowed) expect(d.message).toMatch(/edit or delete/i);
  });
});

describe("decidePrivilegedAccess", () => {
  it("admits only owner and admin", () => {
    expect(decidePrivilegedAccess("owner", "x").allowed).toBe(true);
    expect(decidePrivilegedAccess("admin", "x").allowed).toBe(true);
    expect(decidePrivilegedAccess("handicapper", "x").allowed).toBe(false);
    expect(decidePrivilegedAccess("user", "x").allowed).toBe(false);
    expect(decidePrivilegedAccess("", "x").allowed).toBe(false);
  });
});

// ─── 2. Mutation matrix ───────────────────────────────────────────────────────

describe("decideBetMutation — role × ownership × action", () => {
  const ACTIONS = ["update", "delete"] as const;
  const ACTOR = 10;
  const OTHER_USER = 20;

  it("lets a regular user change only their own bet", () => {
    for (const action of ACTIONS) {
      expect(decideBetMutation({
        actorRole: "user", actorId: ACTOR, betOwnerId: ACTOR, betOwnerRole: "user", action,
      }).allowed).toBe(true);

      expect(decideBetMutation({
        actorRole: "user", actorId: ACTOR, betOwnerId: OTHER_USER, betOwnerRole: "user", action,
      }).allowed).toBe(false);
    }
  });

  it("lets an owner change only their own bet, never another owner's", () => {
    for (const action of ACTIONS) {
      expect(decideBetMutation({
        actorRole: "owner", actorId: ACTOR, betOwnerId: ACTOR, betOwnerRole: "owner", action,
      }).allowed).toBe(true);

      expect(decideBetMutation({
        actorRole: "owner", actorId: ACTOR, betOwnerId: OTHER_USER, betOwnerRole: "owner", action,
      }).allowed).toBe(false);
    }
  });

  it("lets an admin change handicapper and user bets but not owner bets", () => {
    for (const action of ACTIONS) {
      for (const ownerRole of ["handicapper", "user"]) {
        expect(decideBetMutation({
          actorRole: "admin", actorId: ACTOR, betOwnerId: OTHER_USER, betOwnerRole: ownerRole, action,
        }).allowed, `admin → ${ownerRole}`).toBe(true);
      }
      expect(decideBetMutation({
        actorRole: "admin", actorId: ACTOR, betOwnerId: OTHER_USER, betOwnerRole: "owner", action,
      }).allowed).toBe(false);
    }
  });

  it("lets an admin who is somehow flagged owner still edit their own bet", () => {
    expect(decideBetMutation({
      actorRole: "admin", actorId: ACTOR, betOwnerId: ACTOR, betOwnerRole: "owner", action: "update",
    }).allowed).toBe(true);
  });

  it("blocks a handicapper from direct mutation even on their OWN bet", () => {
    // This is the whole point of the edit-request workflow — ownership does not
    // grant a handicapper direct write access.
    for (const action of ACTIONS) {
      const d = decideBetMutation({
        actorRole: "handicapper", actorId: ACTOR, betOwnerId: ACTOR, betOwnerRole: "handicapper", action,
      });
      expect(d.allowed).toBe(false);
      if (!d.allowed) expect(d.message).toMatch(/edit request/i);
    }
  });

  it("phrases the refusal with the attempted verb", () => {
    const del = decideBetMutation({
      actorRole: "user", actorId: ACTOR, betOwnerId: OTHER_USER, betOwnerRole: "user", action: "delete",
    });
    expect(del.allowed).toBe(false);
    if (!del.allowed) expect(del.message).toContain("delete");
  });
});

// ─── 3. Stake math ────────────────────────────────────────────────────────────

describe("calcToWin", () => {
  it("pays plus-money at odds/100", () => {
    expect(calcToWin(155, 3)).toBeCloseTo(4.65, 2);
    expect(calcToWin(100, 10)).toBeCloseTo(10, 2);
  });
  it("pays minus-money at 100/|odds|", () => {
    expect(calcToWin(-110, 11)).toBeCloseTo(10, 2);
    expect(calcToWin(-153, 7.65)).toBeCloseTo(5, 2);
  });
});

describe("toUnits", () => {
  it("prefers the stored unit count over the dollar amount", () => {
    expect(toUnits(300, "3", 100)).toBe(3);
    expect(toUnits(300, 3, 100)).toBe(3);
  });
  it("falls back to dollars ÷ unitSize when units were never stored", () => {
    expect(toUnits(300, null, 100)).toBe(3);
    expect(toUnits(250, "", 50)).toBe(5);
  });
  it("ignores a stored value that is zero, negative or unparseable", () => {
    expect(toUnits(300, "0", 100)).toBe(3);
    expect(toUnits(300, "-2", 100)).toBe(3);
    expect(toUnits(300, "abc", 100)).toBe(3);
  });
  it("never divides by zero", () => {
    expect(Number.isFinite(toUnits(300, null, 0))).toBe(true);
  });
});

describe("calcUnitBucket", () => {
  it("uses RISK as the unit count on plus money", () => {
    expect(calcUnitBucket({ odds: 155, risk: 300, toWin: 465, riskUnits: 3, toWinUnits: 4.65, unitSize: 100 })).toBe("3U");
  });

  it("uses TO-WIN as the unit count on minus money", () => {
    expect(calcUnitBucket({ odds: -153, risk: 765, toWin: 500, riskUnits: 7.65, toWinUnits: 5, unitSize: 100 })).toBe("5U");
  });

  it("REGRESSION: a legacy row with no stored units buckets on units, not raw dollars", () => {
    // Before the fix this fell back to the raw dollar amount, so a $300 risk was
    // read as "300 units" and every legacy bet collapsed into 10U — while the
    // ROI shown beside it was computed correctly in units.
    expect(calcUnitBucket({ odds: 155, risk: 300, toWin: 465, riskUnits: null, toWinUnits: null, unitSize: 100 })).toBe("3U");
    expect(calcUnitBucket({ odds: -110, risk: 110, toWin: 100, riskUnits: null, toWinUnits: null, unitSize: 100 })).toBe("1U");
  });

  it("respects the viewer's unit size for legacy rows", () => {
    expect(calcUnitBucket({ odds: 120, risk: 250, toWin: 300, riskUnits: null, toWinUnits: null, unitSize: 50 })).toBe("5U");
  });

  it("REGRESSION: a sub-unit stake gets its own bucket, not a rounded-up 1U", () => {
    // A $1.10 stake at $100/unit is 0.011 units. Math.round sent that to 0 and
    // the bucket chain then labelled it "1U" — a 110x overstatement sitting
    // beside genuine 1U plays in the BY UNIT SIZE breakdown. Four such rows
    // existed on 2026-08-03, the smallest 0.01U.
    const b = (u: number) =>
      calcUnitBucket({ odds: 110, risk: u, toWin: u, riskUnits: u, toWinUnits: u, unitSize: 100 });
    expect(b(0.01)).toBe("<1U");
    expect(b(0.05)).toBe("<1U");
    expect(b(0.4)).toBe("<1U");
    expect(b(0.49)).toBe("<1U");
    // 0.5 and up still round into the real buckets, unchanged.
    expect(b(0.5)).toBe("1U");
    expect(b(0.9)).toBe("1U");
  });

  it("the legacy-dollar path also reaches the sub-unit bucket", () => {
    // The exact production shape: risk=$1.10, unitSize=$100, no stored units.
    expect(calcUnitBucket({
      odds: 110, risk: 1.1, toWin: 1, riskUnits: null, toWinUnits: null, unitSize: 100,
    })).toBe("<1U");
  });

  it("sub-unit sorts last in the bucket order", () => {
    expect(UNIT_BUCKET_ORDER[UNIT_BUCKET_ORDER.length - 1]).toBe("<1U");
  });

  it("maps every bucket boundary", () => {
    const bucket = (u: number) =>
      calcUnitBucket({ odds: 110, risk: u, toWin: u, riskUnits: u, toWinUnits: u, unitSize: 100 });
    expect(bucket(1)).toBe("1U");
    expect(bucket(2)).toBe("2U");
    expect(bucket(3)).toBe("3U");
    expect(bucket(4)).toBe("4U");
    expect(bucket(5)).toBe("5U");
    expect(bucket(9)).toBe("5U");
    expect(bucket(10)).toBe("10U");
    expect(bucket(50)).toBe("10U");
  });
});

describe("derivePickLabel", () => {
  it("labels moneylines and run lines by team", () => {
    expect(derivePickLabel("AWAY", "ML", "HOU", "SEA")).toBe("HOU ML");
    expect(derivePickLabel("HOME", "RL", "HOU", "SEA")).toBe("SEA RL");
  });
  it("labels totals by side", () => {
    expect(derivePickLabel("OVER", "TOTAL", "HOU", "SEA")).toBe("OVER");
    expect(derivePickLabel("UNDER", "TOTAL", "HOU", "SEA")).toBe("UNDER");
  });
  it("labels NRFI/YRFI by timeframe, not team", () => {
    expect(derivePickLabel("AWAY", "ML", "HOU", "SEA", "NRFI")).toBe("NRFI");
    expect(derivePickLabel("HOME", "ML", "HOU", "SEA", "YRFI")).toBe("YRFI");
  });
});

// ─── 4. Line semantics ────────────────────────────────────────────────────────

describe("marketRequiresLine / effectiveLine", () => {
  it("requires a line for RL and TOTAL only", () => {
    expect(marketRequiresLine("RL")).toBe(true);
    expect(marketRequiresLine("TOTAL")).toBe(true);
    expect(marketRequiresLine("ML")).toBe(false);
  });
  it("prefers an explicit custom line over the book line", () => {
    expect(effectiveLine(-1.5, 8)).toBe(8);
    expect(effectiveLine(-1.5, null)).toBe(-1.5);
    expect(effectiveLine(null, null)).toBe(null);
    expect(effectiveLine("", "")).toBe(null);
  });
  it("keeps a legitimate zero line", () => {
    expect(effectiveLine(0, null)).toBe(0);
  });
});

describe("resolveLineForUpdate — the RL/TOTAL invariant", () => {
  const base = {
    prevMarket: "RL" as Market,
    nextMarket: "RL" as Market,
    prevPickSide: "HOME" as PickSide,
    nextPickSide: "HOME" as PickSide,
    prevLine: "-1.5",
    prevCustomLine: null,
  };

  it("REGRESSION: flipping the run-line side inverts the spread's sign", () => {
    // Before the fix, flipping HOME(-1.5) → AWAY kept -1.5, so the grader read
    // the underdog as a 1.5-run favorite and inverted every one-run margin.
    const res = resolveLineForUpdate({ ...base, nextPickSide: "AWAY" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.line).toBe(1.5);
      expect(res.flipped).toBe(true);
    }
  });

  it("flips the custom line too", () => {
    const res = resolveLineForUpdate({
      ...base, prevLine: null, prevCustomLine: "-2.5", nextPickSide: "AWAY",
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.customLine).toBe(2.5);
  });

  it("does not flip when the side is unchanged", () => {
    const res = resolveLineForUpdate(base);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.line).toBe(-1.5);
      expect(res.flipped).toBe(false);
    }
  });

  it("does not flip a TOTAL when the side changes — a total is not signed", () => {
    const res = resolveLineForUpdate({
      prevMarket: "TOTAL", nextMarket: "TOTAL",
      prevPickSide: "OVER", nextPickSide: "UNDER",
      prevLine: "8.5", prevCustomLine: null,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.line).toBe(8.5);
      expect(res.flipped).toBe(false);
    }
  });

  it("REGRESSION: switching RL→TOTAL refuses to reuse the stored spread", () => {
    // Before the fix a stored -1.5 spread became a total line of -1.5, so every
    // OVER won automatically.
    const res = resolveLineForUpdate({ ...base, nextMarket: "TOTAL" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/requires a new line/i);
  });

  it("accepts a market change when a fresh line comes with it", () => {
    const res = resolveLineForUpdate({ ...base, nextMarket: "TOTAL", nextLine: 8.5 });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.line).toBe(8.5);
  });

  it("clears the line when switching to ML, which has none", () => {
    const res = resolveLineForUpdate({ ...base, nextMarket: "ML" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.line).toBe(null);
      expect(res.customLine).toBe(null);
    }
  });

  it("rejects an explicit null line on a market that requires one", () => {
    const res = resolveLineForUpdate({ ...base, nextLine: null, nextCustomLine: null });
    expect(res.ok).toBe(false);
  });

  it("an explicitly supplied line wins over the flip", () => {
    const res = resolveLineForUpdate({ ...base, nextPickSide: "AWAY", nextLine: 2.5 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.line).toBe(2.5);
      expect(res.flipped).toBe(false);
    }
  });
});

// ─── 5. Cursor codec ──────────────────────────────────────────────────────────

describe("cursor codec", () => {
  it("round-trips", () => {
    const c = { gameDate: "2026-07-24", id: 4821 };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });

  it("returns null for anything malformed rather than throwing", () => {
    for (const bad of [
      null, undefined, "", "{", "[]", "null", "42",
      '{"gameDate":"2026-07-24"}',
      '{"id":5}',
      '{"gameDate":"nope","id":5}',
      '{"gameDate":"2026-07-24","id":"5"}',
      '{"gameDate":"2026-07-24","id":1.5}',
    ]) {
      expect(decodeCursor(bad as string), `input=${String(bad)}`).toBe(null);
    }
  });
});

// ─── 6. Aggregation ───────────────────────────────────────────────────────────

let nextId = 1;
function row(over: Partial<StatRow> = {}): StatRow {
  return {
    id: nextId++,
    gameDate: "2026-07-01",
    result: "WIN",
    sport: "MLB",
    market: "ML",
    betType: "ML",
    timeframe: "FULL_GAME",
    wagerType: "PREGAME",
    pick: "HOU ML",
    odds: -110,
    risk: "110",
    toWin: "100",
    riskUnits: "1.1",
    toWinUnits: "1",
    ...over,
  };
}

describe("aggregateStats", () => {
  it("returns a complete, zeroed block for no rows", () => {
    const s = aggregateStats([], 100);
    expect(s.totalBets).toBe(0);
    expect(s.roi).toBe(0);
    expect(s.equityCurve).toEqual([]);
    expect(s.currentRunSince).toBe("");
    // Every field the UI reads must exist even when empty.
    for (const k of ["dollarNetProfit", "maxDrawdown", "currentRunUnits", "ath", "worstDayUnits", "biggestDayUnits"] as const) {
      expect(s[k], k).toBe(0);
    }
  });

  it("counts results and computes net/ROI in units", () => {
    const s = aggregateStats([
      row({ result: "WIN", riskUnits: "1", toWinUnits: "1" }),
      row({ result: "LOSS", riskUnits: "1", toWinUnits: "1" }),
      row({ result: "WIN", riskUnits: "1", toWinUnits: "1" }),
    ], 100);
    expect(s.wins).toBe(2);
    expect(s.losses).toBe(1);
    expect(s.netProfit).toBe(1);
    expect(s.totalRisk).toBe(3);
    expect(s.roi).toBeCloseTo(33.33, 1);
  });

  it("treats PUSH and VOID as stake-returned: counted, but no risk and no P/L", () => {
    const s = aggregateStats([
      row({ result: "PUSH" }),
      row({ result: "VOID" }),
      row({ result: "PENDING" }),
    ], 100);
    expect(s.pushes).toBe(1);
    expect(s.voids).toBe(1);
    expect(s.pending).toBe(1);
    expect(s.totalRisk).toBe(0);
    expect(s.netProfit).toBe(0);
    expect(s.gradedBets).toBe(1); // PUSH only; VOID and PENDING are not graded outcomes
    expect(s.equityCurve).toHaveLength(0);
  });

  it("REGRESSION: emits dollar P&L at top level and per breakdown entry", () => {
    // The paginated procedure used to omit these, so every "$" figure in the
    // analytics panels silently rendered blank.
    const s = aggregateStats([row({ result: "WIN", riskUnits: "1", toWinUnits: "2" })], 250);
    expect(s.dollarNetProfit).toBe(500);
    expect(s.bySport[0].dollarNetProfit).toBe(500);
    expect(s.byType[0].dollarNetProfit).toBe(500);
  });

  it("REGRESSION: equity points carry label, odds and units", () => {
    // These drove the PICK / ODDS / UNITS columns, which rendered em-dashes.
    const s = aggregateStats([row({ result: "WIN", pick: "SEA RL", odds: 155, riskUnits: "3" })], 100);
    expect(s.equityCurve[0].label).toBe("SEA RL");
    expect(s.equityCurve[0].pick).toBe("SEA RL");
    expect(s.equityCurve[0].odds).toBe(155);
    expect(s.equityCurve[0].units).toBe(3);
  });

  it("builds a cumulative equity curve over graded bets only, in order", () => {
    const s = aggregateStats([
      row({ result: "WIN", gameDate: "2026-07-01", riskUnits: "1", toWinUnits: "1" }),
      row({ result: "PENDING", gameDate: "2026-07-02" }),
      row({ result: "LOSS", gameDate: "2026-07-03", riskUnits: "2", toWinUnits: "1" }),
      row({ result: "WIN", gameDate: "2026-07-04", riskUnits: "1", toWinUnits: "3" }),
    ], 100);
    expect(s.equityCurve.map(p => p.cumPL)).toEqual([1, -1, 2]);
  });

  it("tracks ATH, max drawdown and the current run from the last trough", () => {
    const s = aggregateStats([
      row({ result: "WIN", gameDate: "2026-07-01", riskUnits: "1", toWinUnits: "5" }),  // +5
      row({ result: "LOSS", gameDate: "2026-07-02", riskUnits: "3", toWinUnits: "1" }), // +2
      row({ result: "LOSS", gameDate: "2026-07-03", riskUnits: "1", toWinUnits: "1" }), // +1
      row({ result: "WIN", gameDate: "2026-07-04", riskUnits: "1", toWinUnits: "2" }),  // +3
    ], 100);
    expect(s.ath).toBe(5);
    expect(s.maxDrawdown).toBe(4);       // 5 → 1
    expect(s.currentRunUnits).toBe(2);   // 1 → 3
    expect(s.currentRunSince).toBe("2026-07-03");
  });

  it("finds the best and worst day by aggregated P/L", () => {
    const s = aggregateStats([
      row({ result: "WIN", gameDate: "2026-07-01", riskUnits: "1", toWinUnits: "4" }),
      row({ result: "LOSS", gameDate: "2026-07-02", riskUnits: "2", toWinUnits: "1" }),
      row({ result: "LOSS", gameDate: "2026-07-02", riskUnits: "3", toWinUnits: "1" }),
    ], 100);
    expect(s.biggestDayDate).toBe("2026-07-01");
    expect(s.biggestDayUnits).toBe(4);
    expect(s.worstDayDate).toBe("2026-07-02");
    expect(s.worstDayUnits).toBe(-5);
  });

  it("counts the longest win streak, with pushes neither breaking nor extending it", () => {
    const s = aggregateStats([
      row({ result: "WIN" }), row({ result: "WIN" }),
      row({ result: "PUSH" }),
      row({ result: "WIN" }),
      row({ result: "LOSS" }),
      row({ result: "WIN" }),
    ], 100);
    expect(s.longestWinStreak).toBe(3);
  });

  it("orders unit-size buckets largest-first, with sub-unit last", () => {
    const s = aggregateStats([
      row({ odds: 110, riskUnits: "1", toWinUnits: "1" }),
      row({ odds: 110, riskUnits: "0.01", toWinUnits: "0.01" }),
      row({ odds: 110, riskUnits: "10", toWinUnits: "10" }),
      row({ odds: 110, riskUnits: "3", toWinUnits: "3" }),
    ], 100);
    expect(s.bySize.map(e => e.key)).toEqual(["10U", "3U", "1U", "<1U"]);
  });

  it("breaks down across all seven dimensions", () => {
    const s = aggregateStats([
      row({ sport: "MLB", market: "ML", timeframe: "FULL_GAME", wagerType: "PREGAME", gameDate: "2026-07-01" }),
      row({ sport: "NHL", market: "TOTAL", timeframe: "REGULATION", wagerType: "LIVE", gameDate: "2026-08-01" }),
    ], 100);
    expect(s.bySport.map(e => e.key)).toEqual(["MLB", "NHL"]);
    expect(s.byType.map(e => e.key)).toEqual(["ML", "TOTAL"]);
    expect(s.byTimeframe.map(e => e.key)).toEqual(["FULL_GAME", "REGULATION"]);
    expect(s.byWagerType.map(e => e.key)).toEqual(["LIVE", "PREGAME"]);
    expect(s.byMonth.map(e => e.key)).toEqual(["2026-07", "2026-08"]);
    expect(s.byResult.map(e => e.key)).toEqual(["WIN"]);
    expect(s.bySize.length).toBeGreaterThan(0);
  });

  it("falls back to betType when market is null on a legacy row", () => {
    const s = aggregateStats([row({ market: null, betType: "OVER" })], 100);
    expect(s.byType[0].key).toBe("OVER");
  });

  it("marks ATH, max-drawdown and worst-day points as special", () => {
    const s = aggregateStats([
      row({ result: "WIN", gameDate: "2026-07-01", riskUnits: "1", toWinUnits: "5" }),
      row({ result: "LOSS", gameDate: "2026-07-02", riskUnits: "4", toWinUnits: "1" }),
    ], 100);
    expect(s.equityCurve.filter(p => p.isSpecial).length).toBeGreaterThan(0);
  });

  it("normalizes legacy dollar rows through unitSize consistently", () => {
    const legacy = aggregateStats(
      [row({ result: "WIN", risk: "200", toWin: "200", riskUnits: null, toWinUnits: null })],
      100,
    );
    expect(legacy.totalRisk).toBe(2);
    expect(legacy.netProfit).toBe(2);
    expect(legacy.dollarNetProfit).toBe(200);
  });
});
