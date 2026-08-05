import { describe, expect, it } from "vitest";
import {
  setGatedCacheHeaders,
  stripGameModelFields,
  stripHrPropModelFields,
  stripStrikeoutPropModelFields,
  stripWcMatchupModelFields,
} from "./feedGating";

describe("stripGameModelFields", () => {
  const row = {
    // commodity — MUST survive
    id: 42,
    sport: "MLB",
    awayTeam: "NYY",
    homeTeam: "BOS",
    gameDate: "2026-08-05",
    awayBookSpread: "-1.5",
    bookTotal: "8.5",
    awayRunLine: "-1.5",
    ticketPct: "72",
    awayStartingPitcher: "Gerrit Cole",
    actualAwayScore: 5,
    // proprietary model IP — MUST be nulled
    awayModelSpread: "-1.7",
    homeModelSpread: "1.7",
    modelTotal: "8.9",
    modelAwayWinPct: "0.58",
    modelF5Total: "4.1",
    modelPNrfi: "0.42",
    modelPHr: "0.11",
    modelRunAt: 1785900000000,
    spreadEdge: "3.6",
    totalEdge: "1.2",
    spreadDiff: "0.2",
    totalDiff: "0.4",
  };

  it("nulls every model* field and the edge fields", () => {
    const out = stripGameModelFields(row);
    for (const k of [
      "awayModelSpread",
      "homeModelSpread",
      "modelTotal",
      "modelAwayWinPct",
      "modelF5Total",
      "modelPNrfi",
      "modelPHr",
      "modelRunAt",
      "spreadEdge",
      "totalEdge",
      "spreadDiff",
      "totalDiff",
    ]) {
      expect(out[k as keyof typeof out]).toBeNull();
    }
  });

  it("preserves ALL commodity fields (schedule, book lines, splits, actuals)", () => {
    const out = stripGameModelFields(row);
    expect(out.id).toBe(42);
    expect(out.awayTeam).toBe("NYY");
    expect(out.awayBookSpread).toBe("-1.5");
    expect(out.bookTotal).toBe("8.5");
    expect(out.awayRunLine).toBe("-1.5");
    expect(out.ticketPct).toBe("72");
    expect(out.awayStartingPitcher).toBe("Gerrit Cole");
    expect(out.actualAwayScore).toBe(5);
  });

  it("does not mutate the input row", () => {
    const clone = { ...row };
    stripGameModelFields(row);
    expect(row).toEqual(clone);
  });

  it("catches a hypothetical FUTURE model field via the prefix rule (leak-safe)", () => {
    const out = stripGameModelFields({
      ...row,
      modelBrandNewSignal2027: "0.99",
    } as Record<string, unknown>);
    expect(out.modelBrandNewSignal2027).toBeNull();
  });
});

describe("stripStrikeoutPropModelFields", () => {
  it("nulls projection/edge/model IP, keeps only the commodity book line", () => {
    const out = stripStrikeoutPropModelFields({
      playerId: "cole",
      bookLine: "6.5", // commodity book line — the ONLY thing that survives
      kLine: "6.5", // IP: schema says "Model recommended line"
      kProj: "7.2", // IP
      pOver: "0.61",
      edgeOver: "4.1",
      verdict: "OVER",
      distribution: "{...}",
      matchupRows: "[...]",
      inningBreakdown: "[...]",
      bestMlStr: "-140",
      modelError: "0.3", // reconstructs kProj on finals — IP
      modelRunAt: 123,
    });
    expect(out.bookLine).toBe("6.5"); // commodity — survives
    for (const k of [
      "kLine",
      "kProj",
      "pOver",
      "edgeOver",
      "verdict",
      "distribution",
      "matchupRows",
      "inningBreakdown",
      "bestMlStr",
      "modelError",
      "modelRunAt",
    ]) {
      expect(out[k as keyof typeof out]).toBeNull();
    }
  });
});

describe("stripHrPropModelFields", () => {
  it("nulls the HR model fields, keeps identity/book", () => {
    const out = stripHrPropModelFields({
      playerId: "judge",
      bookOverOdds: "+280", // commodity — keep
      modelPHr: "0.14", // IP
      edgeOver: "6.0",
      evOver: "0.08",
      verdict: "OVER",
    });
    expect(out.playerId).toBe("judge");
    expect(out.bookOverOdds).toBe("+280");
    expect(out.modelPHr).toBeNull();
    expect(out.edgeOver).toBeNull();
    expect(out.evOver).toBeNull();
    expect(out.verdict).toBeNull();
  });
});

describe("stripWcMatchupModelFields", () => {
  it("nulls model odds/edges/probs/projection, keeps schedule + teams", () => {
    const out = stripWcMatchupModelFields({
      matchId: "m1",
      home: "BRA",
      away: "ARG",
      kickoff: "2026-06-12",
      modelOdds: { home: "-120" }, // IP
      homeEdge: "3.1",
      homeWinProb: "0.52",
      projHomeScore: "1.8",
      projection: { foo: 1 },
    });
    expect(out.matchId).toBe("m1");
    expect(out.home).toBe("BRA");
    expect(out.kickoff).toBe("2026-06-12");
    expect(out.modelOdds).toBeNull();
    expect(out.homeEdge).toBeNull();
    expect(out.homeWinProb).toBeNull();
    expect(out.projHomeScore).toBeNull();
    expect(out.projection).toBeNull();
  });
});

describe("setGatedCacheHeaders — cache-leak fix (Phase 4)", () => {
  function spyRes() {
    const headers: Record<string, string> = {};
    return {
      headers,
      setHeader: (name: string, value: string) => {
        headers[name] = value;
      },
    };
  }

  it("authed: private, no-store (never shared/edge-cached) + Vary: Cookie", () => {
    const res = spyRes();
    setGatedCacheHeaders(res, true);
    expect(res.headers["Cache-Control"]).toBe("private, no-store");
    expect(res.headers["Vary"]).toBe("Cookie");
  });

  it("anon: short public cache for the stripped commodity shape + Vary: Cookie", () => {
    const res = spyRes();
    setGatedCacheHeaders(res, false);
    expect(res.headers["Cache-Control"]).toBe(
      "public, max-age=30, stale-while-revalidate=60"
    );
    expect(res.headers["Vary"]).toBe("Cookie");
  });

  it("never throws on a missing/!function res (defensive)", () => {
    expect(() => setGatedCacheHeaders(undefined, true)).not.toThrow();
    expect(() =>
      setGatedCacheHeaders({} as { setHeader?: never }, false)
    ).not.toThrow();
  });
});
