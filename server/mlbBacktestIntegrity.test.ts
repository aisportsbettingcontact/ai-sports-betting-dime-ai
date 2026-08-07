/**
 * Integrity-enrichment tests (grader emission — gaps G1/G3/G4).
 *
 * PROVENANCE / HONESTY NOTE: synthetic fixtures; gamePks in the 9xxxxx range
 * are deliberately not real MLB ids. Fixture verification is never live
 * verification.
 */
import { describe, expect, it } from "vitest";
import { computeIntegrityFields, type IntegrityContext } from "./mlbBacktestIntegrity";
import { matchScheduleHistory, closingPairForMarket, type ScheduleHistoryLite } from "./mlbClosingLineResolver";
import { MLB_MODEL_VERSION, hashEngineSource, currentModelParamsHash, clearModelIdentityCache, UNKNOWN_PARAMS_HASH } from "./mlbModelIdentity";
import { pickSupported } from "./schemaCapabilities";

const START = Date.UTC(2026, 6, 1, 23, 10); // 2026-07-01 23:10Z first pitch

function closingRow(overrides: Partial<ScheduleHistoryLite> = {}): ScheduleHistoryLite {
  return {
    id: 1,
    anGameId: 555001,
    gamePk: 900101,
    gameDate: "2026-07-01",
    startTimeUtc: new Date(START).toISOString(),
    awaySlug: "arizona-diamondbacks",
    homeSlug: "philadelphia-phillies",
    dkClosingAwayRunLine: "1.5",
    dkClosingAwayRunLineOdds: "-144",
    dkClosingHomeRunLine: "-1.5",
    dkClosingHomeRunLineOdds: "+119",
    dkClosingTotal: "8.5",
    dkClosingOverOdds: "-112",
    dkClosingUnderOdds: "-108",
    dkClosingAwayML: "+153",
    dkClosingHomeML: "-186",
    closingLineLockedAt: START,
    ...overrides,
  };
}

function ctx(overrides: Partial<IntegrityContext> = {}): IntegrityContext {
  return {
    gameDate: "2026-07-01",
    startTimeEst: "7:10 PM",
    canonicalStartUtcMs: START,
    modelRunAt: START - 6 * 3600_000, // ran 6h before first pitch
    identity: { modelVersion: MLB_MODEL_VERSION, modelParamsHash: "abcd1234abcd1234" },
    closingRow: closingRow(),
    closingResolution: { method: "EXACT_GAMEPK", confidence: 1.0 },
    ...overrides,
  };
}

const winMl = {
  market: "fg_ml_home",
  modelSide: "home",
  modelProb: 0.62,
  bookLine: null,
  bookOdds: "-150",
  result: "WIN" as const,
  correct: true,
};

describe("computeIntegrityFields — happy path", () => {
  it("emits CLV, P/L, leakage-safe verdict, and version attribution on a WIN", () => {
    const { fields, events } = computeIntegrityFields(winMl, ctx());
    expect(fields.result).toBe("WIN");
    expect(fields.leakageSafe).toBe(1);
    expect(fields.quarantineReason).toBeNull();
    // closing -186/+153 → no-vig home ≈ 0.6180; clv = 0.62 − 0.6180 ≈ 0.002
    expect(fields.closingOdds).toBe("-186");
    expect(fields.closingOddsOpposite).toBe("153");
    expect(fields.clv).not.toBeNull();
    expect(Math.abs(fields.clv! - (0.62 - 186 / 286 / (186 / 286 + 100 / 253)))).toBeLessThan(1e-6);
    // WIN at -150 → +0.6667 units flat stake
    expect(fields.profitLoss).toBeCloseTo(100 / 150, 4);
    expect(fields.auditVersion).toBe(`integrity-v1|${MLB_MODEL_VERSION}|params:abcd1234abcd1234`);
    expect(fields.gameStartUtcMs).toBe(START);
    expect(events.some((e) => e.startsWith("clv:"))).toBe(true);
  });

  it("prefers the canonical start instant over the parsed EST time", () => {
    const canonical = START + 45 * 60_000; // canonical says 45 min later than parsed
    const { fields, events } = computeIntegrityFields(winMl, ctx({ canonicalStartUtcMs: canonical }));
    expect(fields.gameStartUtcMs).toBe(canonical);
    expect(events[0]).toContain("canonical");
  });
});

describe("computeIntegrityFields — leakage quarantine (G4)", () => {
  it("quarantines a settled grade when the model ran after first pitch", () => {
    const { fields } = computeIntegrityFields(winMl, ctx({ modelRunAt: START + 5 * 60_000 }));
    expect(fields.result).toBe("QUARANTINED");
    expect(fields.correct).toBeNull();
    expect(fields.leakageSafe).toBe(0);
    expect(fields.quarantineReason).toContain("PREDICTION_AFTER_FIRST_PITCH");
    // A quarantined row must not contribute skill metrics.
    expect(fields.clv).toBeNull();
    expect(fields.profitLoss).toBeNull();
  });

  it("quarantines when the prediction timestamp is missing entirely", () => {
    const { fields } = computeIntegrityFields(winMl, ctx({ modelRunAt: null }));
    expect(fields.result).toBe("QUARANTINED");
    expect(fields.quarantineReason).toContain("MISSING_PREDICTION_TIMESTAMP");
  });

  it("flags but does not quarantine NO_ACTION rows (no claim to poison)", () => {
    const { fields } = computeIntegrityFields(
      { ...winMl, result: "NO_ACTION", correct: null },
      ctx({ modelRunAt: START + 5 * 60_000 }),
    );
    expect(fields.result).toBe("NO_ACTION");
    expect(fields.leakageSafe).toBe(0);
    expect(fields.quarantineReason).toBeNull();
  });
});

describe("computeIntegrityFields — honest unavailability", () => {
  it("leaves CLV null with a reason when no closing row resolved", () => {
    const { fields, events } = computeIntegrityFields(
      winMl,
      ctx({ closingRow: null, closingResolution: { method: null, reason: "NO_CANDIDATE: nothing on date" } }),
    );
    expect(fields.clv).toBeNull();
    expect(fields.closingOdds).toBeNull();
    expect(events.some((e) => e.includes("NO_CANDIDATE"))).toBe(true);
  });

  it("refuses CLV on a moved total line (different bet), keeps grade", () => {
    const overWin = { ...winMl, market: "fg_over", modelSide: "over", bookLine: "9", bookOdds: "-110" };
    const { fields, events } = computeIntegrityFields(overWin, ctx()); // closing total 8.5 ≠ graded 9
    expect(fields.result).toBe("WIN");
    expect(fields.clv).toBeNull();
    expect(events.some((e) => e.includes("CLOSING_LINE_MISMATCH"))).toBe(true);
  });

  it("F5 markets have no closing source — CLV honestly unavailable", () => {
    const f5 = { ...winMl, market: "f5_ml_home" };
    const { fields, events } = computeIntegrityFields(f5, ctx());
    expect(fields.clv).toBeNull();
    expect(events.some((e) => e.includes("NO_CLOSING_SOURCE"))).toBe(true);
  });

  it("MISSING_DATA rows get no P/L and stay unsettled", () => {
    const { fields } = computeIntegrityFields({ ...winMl, result: "MISSING_DATA", correct: null }, ctx());
    expect(fields.result).toBe("MISSING_DATA");
    expect(fields.profitLoss).toBeNull();
  });

  it("PUSH settles at zero P/L", () => {
    const { fields } = computeIntegrityFields({ ...winMl, result: "PUSH", correct: null }, ctx());
    expect(fields.profitLoss).toBe(0);
  });
});

describe("model identity (G1)", () => {
  it("fingerprints engine source deterministically and reacts to any byte change", () => {
    const a = hashEngineSource("SIMULATIONS = 400000\n");
    expect(a).toBe(hashEngineSource("SIMULATIONS = 400000\n"));
    expect(a).toHaveLength(16);
    expect(a).not.toBe(hashEngineSource("SIMULATIONS = 400001\n"));
  });

  it("hashes the real engine file (or degrades loudly to 'unknown')", () => {
    clearModelIdentityCache();
    const hash = currentModelParamsHash();
    expect(hash === UNKNOWN_PARAMS_HASH || /^[0-9a-f]{16}$/.test(hash)).toBe(true);
    clearModelIdentityCache();
  });

  it("returns 'unknown' for an unreadable engine path", () => {
    clearModelIdentityCache();
    expect(currentModelParamsHash("/nonexistent/engine.py")).toBe(UNKNOWN_PARAMS_HASH);
    clearModelIdentityCache();
  });
});

describe("schema capability gating (deploy law)", () => {
  it("pickSupported drops fields the live schema cannot accept", () => {
    const fields = { modelVersion: "mlb-mc-v1", modelParamsHash: "abc" };
    expect(pickSupported(fields, { modelVersion: true, modelParamsHash: true })).toEqual(fields);
    expect(pickSupported(fields, { modelVersion: false, modelParamsHash: false })).toEqual({});
    expect(pickSupported(fields, { modelVersion: true, modelParamsHash: false })).toEqual({
      modelVersion: "mlb-mc-v1",
    });
  });
});

describe("closing-line resolver — tiered matching (G5)", () => {
  const game = {
    mlbGamePk: 900101,
    gameDate: "2026-07-01",
    awayTeam: "ARI",
    homeTeam: "PHI",
    startUtcMs: START,
  };

  it("T1: exact gamePk join wins at confidence 1.0", () => {
    const outcome = matchScheduleHistory(game, [closingRow()]);
    expect(outcome.matched && outcome.method).toBe("EXACT_GAMEPK");
    expect(outcome.matched && outcome.confidence).toBe(1.0);
  });

  it("refuses duplicate gamePk rows instead of picking one", () => {
    const outcome = matchScheduleHistory(game, [closingRow(), closingRow({ id: 2, anGameId: 555002 })]);
    expect(outcome.matched).toBe(false);
    if (!outcome.matched) expect(outcome.reason).toContain("DUPLICATE_GAMEPK_ROWS");
  });

  it("T2: unique date+teams match via the AN-slug registry", () => {
    const outcome = matchScheduleHistory(game, [closingRow({ gamePk: null })]);
    expect(outcome.matched && outcome.method).toBe("DATE_TEAMS_UNIQUE");
  });

  it("T3: doubleheader disambiguates by start instant, never row order", () => {
    const game1 = closingRow({ id: 1, anGameId: 1, gamePk: null, startTimeUtc: new Date(START).toISOString() });
    const game2 = closingRow({ id: 2, anGameId: 2, gamePk: null, startTimeUtc: new Date(START + 5 * 3600_000).toISOString() });
    const outcome = matchScheduleHistory(game, [game2, game1]); // deliberately out of order
    expect(outcome.matched && outcome.row.anGameId).toBe(1);
    expect(outcome.matched && outcome.method).toBe("DATE_TEAMS_TIME");
  });

  it("refuses ambiguous doubleheaders without a start instant", () => {
    const outcome = matchScheduleHistory(
      { ...game, startUtcMs: null },
      [closingRow({ id: 1, gamePk: null }), closingRow({ id: 2, anGameId: 2, gamePk: null })],
    );
    expect(outcome.matched).toBe(false);
    if (!outcome.matched) expect(outcome.reason).toContain("AMBIGUOUS_DOUBLEHEADER");
  });

  it("rejects unresolvable team abbrevs loudly", () => {
    const outcome = matchScheduleHistory({ ...game, mlbGamePk: null, awayTeam: "NOPE" }, [closingRow({ gamePk: null })]);
    expect(outcome.matched).toBe(false);
    if (!outcome.matched) expect(outcome.reason).toContain("UNRESOLVED_TEAM");
  });
});

describe("closing pair extraction per market", () => {
  const row = closingRow();

  it("moneyline sides map to the right odds pair", () => {
    const home = closingPairForMarket(row, "fg_ml_home", null);
    expect(home).toEqual({ available: true, odds: -186, oddsOpposite: 153, closingLine: null });
    const away = closingPairForMarket(row, "fg_ml_away", null);
    expect(away).toEqual({ available: true, odds: 153, oddsOpposite: -186, closingLine: null });
  });

  it("run line requires the closing line to equal the graded line", () => {
    const ok = closingPairForMarket(row, "fg_rl_home", "-1.5");
    expect(ok.available).toBe(true);
    const moved = closingPairForMarket(closingRow({ dkClosingHomeRunLine: "-2.5" }), "fg_rl_home", "-1.5");
    expect(moved.available).toBe(false);
    if (!moved.available) expect(moved.reason).toContain("CLOSING_LINE_MISMATCH");
  });

  it("total sides share the closing total and its line check", () => {
    const over = closingPairForMarket(row, "fg_over", "8.5");
    expect(over).toEqual({ available: true, odds: -112, oddsOpposite: -108, closingLine: 8.5 });
    const under = closingPairForMarket(row, "fg_under", "8.5");
    expect(under).toEqual({ available: true, odds: -108, oddsOpposite: -112, closingLine: 8.5 });
  });

  it("null closing odds and unsupported markets are honest unavailability", () => {
    const empty = closingPairForMarket(closingRow({ dkClosingHomeML: null }), "fg_ml_home", null);
    expect(empty.available).toBe(false);
    const f5 = closingPairForMarket(row, "f5_over", "4.5");
    expect(f5.available).toBe(false);
    if (!f5.available) expect(f5.reason).toContain("NO_CLOSING_SOURCE");
  });
});
