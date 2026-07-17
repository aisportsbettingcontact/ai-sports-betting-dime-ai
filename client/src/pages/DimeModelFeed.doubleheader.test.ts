/**
 * DimeModelFeed.doubleheader.test.ts — Client rendering identity for MLB
 * doubleheaders (2026-07-17 TB@BOS incident).
 *
 * The feed renders `cards.map(g => <ProjectionCard key={g.id} …/>)`, so the
 * card id IS the React render key. These tests pin:
 *   25/27. two same-matchup rows → two cards
 *   28.    stable per-EVENT ids (DB pk; hardened fallback can't merge a DH)
 *   29.    both start times render in Eastern time labels
 *   26/6.  the feed sort is chronological and keeps both games
 *
 * Follows the repo's no-DOM client test conventions (plain .test.ts, node env).
 */
import { describe, it, expect } from "vitest";
import { mlbRowToCard } from "./DimeModelFeed";

type MlbRowInput = Parameters<typeof mlbRowToCard>[0];

/** Minimal MLB row as games.list returns it (fields the adapter reads). */
function row(overrides: Record<string, unknown>): MlbRowInput {
  return {
    id: 1,
    gameDate: "2026-07-17",
    startTimeEst: "7:10 PM",
    awayTeam: "TB",
    homeTeam: "BOS",
    sport: "MLB",
    gameStatus: "upcoming",
    awayScore: null,
    homeScore: null,
    gameClock: null,
    venue: "Fenway Park",
    doubleHeader: "S",
    gameNumber: 2,
    awayML: null, homeML: null,
    awayRunLine: null, homeRunLine: null,
    awayRunLineOdds: null, homeRunLineOdds: null,
    bookTotal: null, overOdds: null, underOdds: null,
    modelAwayML: null, modelHomeML: null,
    modelAwayWinPct: null, modelHomeWinPct: null,
    modelTotal: null, modelOverRate: null, modelUnderRate: null,
    modelOverOdds: null, modelUnderOdds: null,
    awayModelSpread: null, homeModelSpread: null,
    modelAwaySpreadOdds: null, modelHomeSpreadOdds: null,
    ...overrides,
  } as unknown as MlbRowInput;
}

const g1Row = () => row({ id: 7102, startTimeEst: "1:35 PM", gameNumber: 1 });
const g2Row = () => row({ id: 7101, startTimeEst: "7:10 PM", gameNumber: 2 });

describe("MLB doubleheader client rendering identity", () => {
  it("two same-matchup rows produce two cards with distinct stable ids (render keys)", () => {
    const cards = [g1Row(), g2Row()].map(mlbRowToCard);
    expect(cards).toHaveLength(2);
    expect(cards[0].id).toBe("7102");
    expect(cards[1].id).toBe("7101");
    expect(new Set(cards.map(c => c.id)).size).toBe(2);
  });

  it("both Eastern start times render on the cards", () => {
    const [c1, c2] = [g1Row(), g2Row()].map(mlbRowToCard);
    expect(c1.timeLabel).toContain("1:35");
    expect(c2.timeLabel).toContain("7:10");
  });

  it("id-less rows (fallback path) still get per-EVENT unique ids — a bare matchup key would collapse the doubleheader", () => {
    const cards = [mlbRowToCard(g1Row()), mlbRowToCard(g2Row())];
    const fallbackCards = [
      mlbRowToCard(row({ id: null, startTimeEst: "1:35 PM", gameNumber: 1 })),
      mlbRowToCard(row({ id: null, startTimeEst: "7:10 PM", gameNumber: 2 })),
    ];
    expect(new Set(cards.map(c => c.id)).size).toBe(2);
    expect(new Set(fallbackCards.map(c => c.id)).size).toBe(2);
    // and the fallback id is matchup+date+time+gameNumber, not bare matchup
    expect(fallbackCards[0].id).not.toBe(fallbackCards[1].id);
    expect(fallbackCards[0].id).toContain("1:35 PM");
  });

  it("feed sort (by startTimeEst minutes) is chronological and keeps both games", () => {
    // Mirrors the useFeedCards sort: timeToMinutes ascending.
    const timeToMinutes = (t: string): number => {
      const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(t.trim());
      if (!m) return 9999;
      let h = parseInt(m[1], 10) % 12;
      if (/pm/i.test(m[3])) h += 12;
      return h * 60 + parseInt(m[2], 10);
    };
    const sorted = [g2Row(), g1Row()].sort(
      (a, b) => timeToMinutes(a.startTimeEst as string) - timeToMinutes(b.startTimeEst as string)
    );
    expect(sorted).toHaveLength(2);
    expect(sorted[0].startTimeEst).toBe("1:35 PM");
    expect(sorted[1].startTimeEst).toBe("7:10 PM");
  });
});
