/**
 * betGradingHealth.test.ts — the alarms that turn silent grading failure loud.
 *
 * Before these, a score feed that changed shape produced exactly the same
 * observable behaviour as a quiet night: bets sat PENDING and nobody knew.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  describeGradingErrors,
  describeNoMatch,
  describeStuckBets,
  takeRateLimitSlot,
  __resetGradingAlertRateLimit,
  STUCK_THRESHOLD_HOURS,
  type StuckBet,
} from "./betGradingHealth";

const bet = (over: Partial<StuckBet> = {}): StuckBet => ({
  id: 1, userId: 14, sport: "MLB", gameDate: "2026-08-01",
  awayTeam: "SF", homeTeam: "TEX", hoursPending: 40, ...over,
});

describe("describeStuckBets", () => {
  it("stays silent when nothing is overdue", () => {
    expect(describeStuckBets([])).toBeNull();
    expect(describeStuckBets([bet({ hoursPending: 2 })])).toBeNull();
    expect(describeStuckBets([bet({ hoursPending: STUCK_THRESHOLD_HOURS - 0.5 })])).toBeNull();
  });

  it("fires exactly at the threshold, not a moment before", () => {
    expect(describeStuckBets([bet({ hoursPending: STUCK_THRESHOLD_HOURS })])).not.toBeNull();
  });

  it("ignores bets that are merely pending and reports only the overdue ones", () => {
    const msg = describeStuckBets([
      bet({ id: 1, hoursPending: 3 }),      // tonight's slate — normal
      bet({ id: 2, hoursPending: 50 }),
      bet({ id: 3, hoursPending: 80 }),
    ])!;
    expect(msg).toContain("2 bet(s)");
    expect(msg).toContain("#3");            // oldest surfaced
    expect(msg).toContain("80h");
  });

  it("breaks the count down by sport, so a single-feed outage is obvious", () => {
    const msg = describeStuckBets([
      bet({ id: 1, sport: "MLB", hoursPending: 40 }),
      bet({ id: 2, sport: "MLB", hoursPending: 41 }),
      bet({ id: 3, sport: "NHL", hoursPending: 42 }),
    ])!;
    expect(msg).toMatch(/2 MLB/);
    expect(msg).toMatch(/1 NHL/);
  });

  it("says what it means rather than just reporting a number", () => {
    const msg = describeStuckBets([bet()])!;
    expect(msg).toMatch(/do not settle themselves/i);
    expect(msg).toMatch(/feed/i);
  });

  it("tolerates null team names without rendering 'null'", () => {
    const msg = describeStuckBets([bet({ awayTeam: null, homeTeam: null })])!;
    expect(msg).not.toContain("null@null");
    expect(msg).toContain("?@?");
  });
});

describe("describeGradingErrors", () => {
  it("is silent on a clean cycle", () => {
    expect(describeGradingErrors({ date: "2026-08-01", total: 10, graded: 10, errors: 0 })).toBeNull();
  });

  it("reports the ratio and the underlying reasons", () => {
    const msg = describeGradingErrors({
      date: "2026-08-01", total: 10, graded: 7, errors: 3,
      details: [
        { betId: 1, result: "ERROR", reason: "fetch failed" },
        { betId: 2, result: "WIN", reason: "graded fine" },
        { betId: 3, result: "ERROR", reason: "timeout" },
      ],
    })!;
    expect(msg).toContain("3 of 10");
    expect(msg).toContain("7 settled successfully");
    expect(msg).toContain("#1: fetch failed");
    expect(msg).not.toContain("graded fine");   // successes are not errors
  });
});

describe("describeNoMatch — the early warning", () => {
  const d = (betId: number, reason: string) => ({ betId, result: "PENDING", reason });

  it("tolerates isolated misses (a postponed fixture is not an outage)", () => {
    expect(describeNoMatch([d(1, "Game X@Y not found in MLB scores for 2026-08-01")])).toBeNull();
    expect(describeNoMatch([
      d(1, "Game X@Y not found in MLB scores for 2026-08-01"),
      d(2, "Game A@B not found in MLB scores for 2026-08-01"),
    ])).toBeNull();
  });

  it("fires on a cluster — that is vocabulary drift, not bad luck", () => {
    const msg = describeNoMatch([
      d(1, "Game X@Y not found in MLB scores for 2026-08-01"),
      d(2, "Game A@B not found in MLB scores for 2026-08-01"),
      d(3, "Game C@D not found in MLB scores for 2026-08-01"),
    ])!;
    expect(msg).toContain("3 bet(s)");
    expect(msg).toMatch(/ABBREV_ALIASES/);
  });

  it("counts an ambiguous prefix match as a no-match signal", () => {
    // findGame now refuses to guess between ATH/ATL, LAA/LAD, NYM/NYY. Those
    // refusals must surface, or the safety fix becomes silent stuck bets.
    const msg = describeNoMatch([
      d(1, "AMBIGUOUS prefix match for NYM@LAA — 2 candidates"),
      d(2, "AMBIGUOUS prefix match for ATH@X — 2 candidates"),
      d(3, "AMBIGUOUS prefix match for MIA@Y — 3 candidates"),
    ]);
    expect(msg).not.toBeNull();
  });

  it("ignores ordinary pending reasons", () => {
    expect(describeNoMatch([
      d(1, "Game in progress or not yet started (state=In Progress)"),
      d(2, "Game in progress or not yet started (state=Pre-Game)"),
      d(3, "Game in progress or not yet started (state=Scheduled)"),
    ])).toBeNull();
  });
});

describe("rate limiting", () => {
  beforeEach(() => __resetGradingAlertRateLimit());

  it("allows the first alert of a kind and suppresses the immediate repeat", () => {
    const t = 1_000_000;
    expect(takeRateLimitSlot("STUCK_BETS", t)).toBe(true);
    expect(takeRateLimitSlot("STUCK_BETS", t + 1_000)).toBe(false);
  });

  it("reopens after the window", () => {
    const t = 1_000_000;
    expect(takeRateLimitSlot("STUCK_BETS", t)).toBe(true);
    expect(takeRateLimitSlot("STUCK_BETS", t + 60 * 60 * 1000 + 1)).toBe(true);
  });

  it("limits each kind independently — a stuck-bet storm must not mask an error", () => {
    const t = 1_000_000;
    expect(takeRateLimitSlot("STUCK_BETS", t)).toBe(true);
    expect(takeRateLimitSlot("GRADING_ERRORS", t)).toBe(true);
    expect(takeRateLimitSlot("NO_MATCH", t)).toBe(true);
  });
});
