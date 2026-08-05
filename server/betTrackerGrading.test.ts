/**
 * betTrackerGrading.test.ts — settlement correctness.
 *
 * Covers the two things that decide whether a graded bet is right:
 *   1. classifyGameState — does this game count, and is it over?
 *   2. gradeBet          — given a final score, did the pick win?
 *
 * Both are pure. `gradeTrackedBet` (the async wrapper that fetches scores) is
 * deliberately not exercised here — it needs network — but every rule it applies
 * lives in one of these two functions.
 */

import { describe, it, expect } from "vitest";
import {
  classifyGameState,
  isFinalState,
  gradeBet,
  findGame,
  type TimeframeScore,
  type GameScoreData,
} from "./scoreGrader";

const score = (away: number, home: number): TimeframeScore => ({
  awayScore: away,
  homeScore: home,
  isFinal: true,
  label: "Full Game",
});

// ─── Settlement state machine ─────────────────────────────────────────────────

describe("classifyGameState", () => {
  it("recognises finished games across every feed's vocabulary", () => {
    for (const s of ["Final", "Game Over", "FINAL", "OFF", "final"]) {
      expect(classifyGameState(s), s).toBe("FINAL");
    }
  });

  it("REGRESSION: 'Completed Early' is FINAL — rain-shortened games are official", () => {
    // These were excluded from the final check, so a legitimately settled
    // rain-shortened game never graded and sat PENDING forever.
    expect(classifyGameState("Completed Early")).toBe("FINAL");
    expect(classifyGameState("Completed Early: Rain")).toBe("FINAL");
    expect(isFinalState("Completed Early: Rain")).toBe(true);
  });

  it("REGRESSION: postponed and cancelled are NO_CONTEST, never FINAL", () => {
    for (const s of [
      "Postponed",
      "Postponed: Rain",
      "Cancelled",
      "Canceled",
      "PPD",
    ]) {
      expect(classifyGameState(s), s).toBe("NO_CONTEST");
      expect(isFinalState(s), s).toBe(false);
    }
  });

  it("keeps suspended games IN_PROGRESS — MLB resumes them, so voiding would be wrong", () => {
    expect(classifyGameState("Suspended")).toBe("IN_PROGRESS");
    expect(classifyGameState("Suspended: Rain")).toBe("IN_PROGRESS");
  });

  it("recognises live states", () => {
    for (const s of [
      "In Progress",
      "LIVE",
      "CRIT",
      "in",
      "Warmup",
      "Delayed",
      "Manager Challenge",
    ]) {
      expect(classifyGameState(s), s).toBe("IN_PROGRESS");
    }
  });

  it("defaults unknown or empty vocabulary to SCHEDULED, never to FINAL", () => {
    for (const s of [
      "",
      "   ",
      "Pre-Game",
      "Scheduled",
      "Preview",
      "some-new-state",
      null,
      undefined,
    ]) {
      expect(classifyGameState(s as string), String(s)).not.toBe("FINAL");
    }
  });

  it("matches short codes exactly so they cannot fire inside a longer word", () => {
    // "off" must not match inside e.g. a playoff/kickoff-style label.
    expect(classifyGameState("Playoff Preview")).toBe("SCHEDULED");
    expect(classifyGameState("OFF")).toBe("FINAL");
  });

  it("REGRESSION: 'Preview' is SCHEDULED, not live — it contains 'review'", () => {
    // A bare "review" marker (added for replay reviews) matched "Preview", the
    // standard not-yet-started state, marking every scheduled game as live and
    // forcing the short score-cache TTL on slates with nothing in progress.
    expect(classifyGameState("Preview")).toBe("SCHEDULED");
    expect(classifyGameState("Pre-Game")).toBe("SCHEDULED");
    expect(classifyGameState("Under Review")).toBe("IN_PROGRESS");
  });

  it("prefers NO_CONTEST when a string could read as more than one state", () => {
    expect(classifyGameState("Final - Postponed")).toBe("NO_CONTEST");
  });
});

// ─── Moneyline ────────────────────────────────────────────────────────────────

describe("gradeBet — ML", () => {
  it("pays the winning side", () => {
    expect(gradeBet(score(5, 3), "ML", "AWAY", null, "MLB")).toBe("WIN");
    expect(gradeBet(score(5, 3), "ML", "HOME", null, "MLB")).toBe("LOSS");
    expect(gradeBet(score(2, 6), "ML", "HOME", null, "MLB")).toBe("WIN");
    expect(gradeBet(score(2, 6), "ML", "AWAY", null, "MLB")).toBe("LOSS");
  });

  it("pushes a tie", () => {
    expect(gradeBet(score(3, 3), "ML", "AWAY", null, "MLB")).toBe("PUSH");
    expect(gradeBet(score(0, 0), "ML", "HOME", null, "NHL")).toBe("PUSH");
  });

  it("needs no line", () => {
    expect(gradeBet(score(5, 3), "ML", "AWAY", null, "NBA")).toBe("WIN");
  });
});

// ─── Run line / spread ────────────────────────────────────────────────────────

describe("gradeBet — RL", () => {
  it("grades the favorite laying the runs", () => {
    // HOME -1.5, home wins by 2 → covers.
    expect(gradeBet(score(3, 5), "RL", "HOME", -1.5, "MLB")).toBe("WIN");
    // HOME -1.5, home wins by 1 → does not cover.
    expect(gradeBet(score(4, 5), "RL", "HOME", -1.5, "MLB")).toBe("LOSS");
  });

  it("grades the underdog taking the runs", () => {
    // AWAY +1.5, away loses by 1 → covers.
    expect(gradeBet(score(4, 5), "RL", "AWAY", 1.5, "MLB")).toBe("WIN");
    // AWAY +1.5, away loses by 2 → does not cover.
    expect(gradeBet(score(3, 5), "RL", "AWAY", 1.5, "MLB")).toBe("LOSS");
  });

  it("REGRESSION: the two sides of the same game grade oppositely", () => {
    // The old default (-1.5 whenever no line was stored) made both sides of a
    // one-run game grade identically. Signs must mirror.
    const oneRun = score(4, 5);
    expect(gradeBet(oneRun, "RL", "HOME", -1.5, "MLB")).toBe("LOSS");
    expect(gradeBet(oneRun, "RL", "AWAY", 1.5, "MLB")).toBe("WIN");
  });

  it("pushes an exact cover on a whole-number spread", () => {
    // HOME -3, home wins by exactly 3.
    expect(gradeBet(score(100, 103), "RL", "HOME", -3, "NBA")).toBe("PUSH");
  });

  it("REGRESSION: refuses to grade with no line instead of assuming -1.5 or 0", () => {
    // Assuming -1.5 inverted every underdog run line; assuming 0 for NBA/NCAAM
    // silently graded a spread bet as a moneyline.
    expect(gradeBet(score(4, 5), "RL", "AWAY", null, "MLB")).toBe("NO_RESULT");
    expect(gradeBet(score(4, 5), "RL", "HOME", undefined, "NHL")).toBe(
      "NO_RESULT"
    );
    expect(gradeBet(score(100, 103), "RL", "HOME", null, "NBA")).toBe(
      "NO_RESULT"
    );
  });

  it("handles a large NBA spread on both sides", () => {
    expect(gradeBet(score(95, 110), "RL", "HOME", -10.5, "NBA")).toBe("WIN");
    expect(gradeBet(score(95, 110), "RL", "AWAY", 10.5, "NBA")).toBe("LOSS");
  });
});

// ─── Totals ───────────────────────────────────────────────────────────────────

describe("gradeBet — TOTAL", () => {
  it("grades over and under against the line", () => {
    expect(gradeBet(score(5, 4), "TOTAL", "OVER", 8.5, "MLB")).toBe("WIN");
    expect(gradeBet(score(5, 4), "TOTAL", "UNDER", 8.5, "MLB")).toBe("LOSS");
    expect(gradeBet(score(2, 3), "TOTAL", "UNDER", 8.5, "MLB")).toBe("WIN");
    expect(gradeBet(score(2, 3), "TOTAL", "OVER", 8.5, "MLB")).toBe("LOSS");
  });

  it("pushes when the total lands exactly on a whole-number line", () => {
    expect(gradeBet(score(4, 4), "TOTAL", "OVER", 8, "MLB")).toBe("PUSH");
    expect(gradeBet(score(4, 4), "TOTAL", "UNDER", 8, "MLB")).toBe("PUSH");
  });

  it("refuses to grade with no line", () => {
    expect(gradeBet(score(5, 4), "TOTAL", "OVER", null, "MLB")).toBe(
      "NO_RESULT"
    );
  });

  it("grades a zero total (NRFI)", () => {
    expect(gradeBet(score(0, 0), "TOTAL", "UNDER", 0.5, "MLB")).toBe("WIN");
    expect(gradeBet(score(0, 1), "TOTAL", "UNDER", 0.5, "MLB")).toBe("LOSS");
  });
});

// ─── Game matching — the fallback must never guess ────────────────────────────

const game = (away: string, home: string, id: string): GameScoreData => ({
  sport: "MLB",
  gameId: id,
  startTime: "",
  awayAbbrev: away,
  homeAbbrev: home,
  gameState: "Final",
  scores: {},
});

describe("findGame — ambiguity must not resolve to a guess", () => {
  it("matches exactly when the abbreviations agree", () => {
    const games = [game("SF", "TEX", "1"), game("TOR", "HOU", "2")];
    expect(findGame(games, "SF", "TEX")?.gameId).toBe("1");
  });

  it("resolves the AZ/ARI alias in both directions", () => {
    expect(findGame([game("SD", "AZ", "1")], "SD", "ARI")?.gameId).toBe("1");
    expect(findGame([game("SD", "ARI", "1")], "SD", "AZ")?.gameId).toBe("1");
  });

  it("accepts a UNIQUE prefix match for vocabulary drift", () => {
    // Feed renamed the home side; only one candidate shares the prefix.
    expect(findGame([game("SF", "TEXAS", "9")], "SF", "TEX")?.gameId).toBe("9");
  });

  it("REGRESSION: refuses when a 2-char prefix is ambiguous", () => {
    // NYM@LAA vs NYY@LAD both match on NY.. / LA.. . The old fallback returned
    // the first hit, so a bet could be graded against the WRONG GAME and look
    // entirely legitimate afterwards. Same-city pairs play on the same date
    // constantly, so this was reachable.
    const slate = [game("NYY", "LAD", "1"), game("NYM", "LAA", "2")];
    // Force the prefix path with an abbreviation the feed does not carry.
    expect(findGame(slate, "NY", "LA")).toBeNull();
  });

  it("REGRESSION: refuses across the other real collision groups", () => {
    for (const [a, b] of [
      ["ATH", "ATL"],
      ["MIA", "MIL"],
      ["NYM", "NYY"],
      ["LAA", "LAD"],
    ]) {
      const slate = [game("SF", a, "1"), game("SF", b, "2")];
      expect(findGame(slate, "SF", b.slice(0, 2)), `${a}/${b}`).toBeNull();
    }
  });

  it("returns null when nothing matches at all", () => {
    expect(findGame([game("SF", "TEX", "1")], "BOS", "NYY")).toBeNull();
  });
});
