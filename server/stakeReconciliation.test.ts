/**
 * stakeReconciliation.test.ts — the stake quad stays coherent under every write.
 *
 * A tracked bet carries four stake figures: risk / toWin (dollars, DECIMAL 10,2)
 * and riskUnits / toWinUnits (units, DECIMAL 12,4). Two laws bind them:
 *
 *   THE PAIR LAW      toWinUnits = toWin × riskUnits / risk — the payout
 *                     multiple is identical in both denominations.
 *   THE SIZE LAW      a row's implied unit size (risk / riskUnits) is fixed at
 *                     creation and held constant by every later write, unless
 *                     the caller restates the basis (risk AND riskUnits together).
 *
 * `deriveToWinUnits` is the pair law as one function; `resolveStakePatch` is
 * the only implementation of a stake-touching UPDATE — it enforces the role
 * gate (owner/admin: $ or U; everyone else: units only) and derives whichever
 * side of the quad the caller did not state.
 */

import { describe, it, expect } from "vitest";
import { deriveToWinUnits, resolveStakePatch } from "./betTrackerCore";

// ─── deriveToWinUnits ─────────────────────────────────────────────────────────

describe("deriveToWinUnits — the pair law", () => {
  it("toWinUnits = toWin × riskUnits / risk at 4dp", () => {
    expect(deriveToWinUnits(100, 91.0, 1)).toBe("0.9100");
    expect(deriveToWinUnits(50, 200, 0.5)).toBe("2.0000");
    expect(deriveToWinUnits(100, 90.91, 2)).toBe("1.8182");
  });

  it("REGRESSION (migration 0132): keeps scale-4 precision — 0.685 is not 0.69", () => {
    // The first production parlay: $25 at a $100 unit paying $68.50. Stored at
    // scale 2 this became 0.69u, implying $69.00 — real money lost to rounding.
    expect(deriveToWinUnits(25, 68.5, 0.25)).toBe("0.6850");
  });

  it("null when there is no usable unit basis", () => {
    expect(deriveToWinUnits(100, 91, null)).toBeNull();
    expect(deriveToWinUnits(100, 91, undefined)).toBeNull();
    expect(deriveToWinUnits(100, 91, 0)).toBeNull();
    expect(deriveToWinUnits(100, 91, -1)).toBeNull();
    expect(deriveToWinUnits(0, 91, 1)).toBeNull();
    expect(deriveToWinUnits(100, 91, "")).toBeNull();
  });

  it("accepts DECIMAL strings as they come off the mysql2 driver", () => {
    expect(deriveToWinUnits(25, 68.5, "0.2500")).toBe("0.6850");
    expect(deriveToWinUnits(100, 91.0, "1.0000")).toBe("0.9100");
  });
});

// ─── resolveStakePatch ────────────────────────────────────────────────────────

/** A subscriber row created at a $100 unit: 1u at +120. */
const paired = { risk: "100.00", toWin: "120.00", riskUnits: "1.0000", toWinUnits: "1.2000" };
/** A legacy / owner dollar row with no unit basis. */
const unpaired = { risk: "100.00", toWin: "120.00", riskUnits: null, toWinUnits: null };

describe("resolveStakePatch — the role gate", () => {
  it("[GATE-1] a units-only actor may not state dollar risk", () => {
    const r = resolveStakePatch({ actorRole: "user", existing: paired, odds: 120, oddsChanged: false, risk: 250 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/units/i);
  });

  it("[GATE-2] a units-only actor may not state dollar toWin", () => {
    const r = resolveStakePatch({ actorRole: "user", existing: paired, odds: 120, oddsChanged: false, toWin: 500 });
    expect(r.ok).toBe(false);
  });

  it("[GATE-3] fail closed: an unknown role is units-only here too", () => {
    const r = resolveStakePatch({ actorRole: "some_new_role", existing: paired, odds: 120, oddsChanged: false, risk: 250 });
    expect(r.ok).toBe(false);
  });

  it("[GATE-4] owner and admin may state dollars", () => {
    for (const role of ["owner", "admin"]) {
      const r = resolveStakePatch({ actorRole: role, existing: paired, odds: 120, oddsChanged: false, risk: 250 });
      expect(r.ok, role).toBe(true);
    }
  });
});

describe("resolveStakePatch — unit-first restatements (any role)", () => {
  it("[U-1] riskUnits restated: dollars follow at the HELD unit size, payout scales", () => {
    const r = resolveStakePatch({ actorRole: "user", existing: paired, odds: 120, oddsChanged: false, riskUnits: 2.5 });
    expect(r).toEqual({
      ok: true,
      fields: { riskUnits: "2.5000", risk: "250.00", toWin: "300.00", toWinUnits: "3.0000" },
    });
  });

  it("[U-2] a boosted payout survives a stake restatement (proportional, not calcToWin)", () => {
    // Boosted row: +120 odds but the book pays $150 on $100. Restating the
    // stake to 2u must scale the boost (→ $300), not regress it to arithmetic
    // ($240 via calcToWin).
    const boosted = { risk: "100.00", toWin: "150.00", riskUnits: "1.0000", toWinUnits: "1.5000" };
    const r = resolveStakePatch({ actorRole: "user", existing: boosted, odds: 120, oddsChanged: false, riskUnits: 2 });
    expect(r).toEqual({
      ok: true,
      fields: { riskUnits: "2.0000", risk: "200.00", toWin: "300.00", toWinUnits: "3.0000" },
    });
  });

  it("[U-3] toWinUnits restated alone: dollars follow, units stored verbatim", () => {
    const r = resolveStakePatch({ actorRole: "user", existing: paired, odds: 120, oddsChanged: false, toWinUnits: 1.5 });
    expect(r).toEqual({ ok: true, fields: { toWin: "150.00", toWinUnits: "1.5000" } });
  });

  it("[U-4] toWinUnits on a row with no unit basis is refused, not guessed", () => {
    const r = resolveStakePatch({ actorRole: "owner", existing: unpaired, odds: 120, oddsChanged: false, toWinUnits: 1.5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/unit basis/i);
  });

  it("[U-5] riskUnits on a legacy unpaired row creates the pair anchored to current dollars", () => {
    const r = resolveStakePatch({ actorRole: "user", existing: unpaired, odds: 120, oddsChanged: false, riskUnits: 2 });
    // Dollars did not move (no size to derive from) and toWin is untouched —
    // but the unit side now exists and satisfies the pair law:
    // toWinUnits = 120 × 2 / 100 = 2.4.
    expect(r).toEqual({
      ok: true,
      fields: { riskUnits: "2.0000", risk: "100.00", toWinUnits: "2.4000" },
    });
  });
});

describe("resolveStakePatch — dollar-first restatements (privileged only)", () => {
  it("[D-1] risk restated: units follow at the held size, payout scales", () => {
    const r = resolveStakePatch({ actorRole: "owner", existing: paired, odds: 120, oddsChanged: false, risk: 250 });
    expect(r).toEqual({
      ok: true,
      fields: { risk: "250.00", riskUnits: "2.5000", toWin: "300.00", toWinUnits: "3.0000" },
    });
  });

  it("[D-2] risk restated on an unpaired row: dollars move, units stay absent", () => {
    const r = resolveStakePatch({ actorRole: "owner", existing: unpaired, odds: 120, oddsChanged: false, risk: 250 });
    expect(r).toEqual({ ok: true, fields: { risk: "250.00", toWin: "300.00" } });
  });

  it("[D-3] explicit toWin (boost) is verbatim and toWinUnits follows the pair law", () => {
    const r = resolveStakePatch({ actorRole: "owner", existing: paired, odds: 120, oddsChanged: false, toWin: 155 });
    expect(r).toEqual({ ok: true, fields: { toWin: "155.00", toWinUnits: "1.5500" } });
  });

  it("[D-4] risk AND riskUnits together define a NEW basis", () => {
    // $500 at 2u is a $250 unit — both stored verbatim, payout scales with risk.
    const r = resolveStakePatch({ actorRole: "owner", existing: paired, odds: 120, oddsChanged: false, risk: 500, riskUnits: 2 });
    expect(r).toEqual({
      ok: true,
      fields: { risk: "500.00", riskUnits: "2.0000", toWin: "600.00", toWinUnits: "2.4000" },
    });
  });
});

describe("resolveStakePatch — odds changes", () => {
  it("[O-1] an odds change moves BOTH payout figures (no stale toWinUnits)", () => {
    const r = resolveStakePatch({ actorRole: "user", existing: paired, odds: -110, oddsChanged: true });
    expect(r).toEqual({ ok: true, fields: { toWin: "90.91", toWinUnits: "0.9091" } });
  });

  it("[O-2] an odds change on an unpaired row moves only the dollar payout", () => {
    const r = resolveStakePatch({ actorRole: "owner", existing: unpaired, odds: -110, oddsChanged: true });
    expect(r).toEqual({ ok: true, fields: { toWin: "90.91" } });
  });

  it("[O-3] odds change + unit restatement compose: new price at the new stake", () => {
    const r = resolveStakePatch({ actorRole: "user", existing: paired, odds: -110, oddsChanged: true, riskUnits: 2 });
    // 2u at the held $100 unit = $200; calcToWin(-110, 200) = 181.82; pair law → 1.8182u.
    expect(r).toEqual({
      ok: true,
      fields: { riskUnits: "2.0000", risk: "200.00", toWin: "181.82", toWinUnits: "1.8182" },
    });
  });
});

describe("resolveStakePatch — no-ops", () => {
  it("[N-1] nothing stake-related sent → empty fields, ok", () => {
    const r = resolveStakePatch({ actorRole: "user", existing: paired, odds: 120, oddsChanged: false });
    expect(r).toEqual({ ok: true, fields: {} });
  });

  it("[N-2] a units-only actor touching nothing stake-related is not gated", () => {
    // notes/result-only edits (the shipped edit dialog) must keep working.
    const r = resolveStakePatch({ actorRole: "user", existing: unpaired, odds: 120, oddsChanged: false });
    expect(r).toEqual({ ok: true, fields: {} });
  });
});
