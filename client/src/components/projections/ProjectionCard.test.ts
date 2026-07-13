import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectionCard } from "./ProjectionCard";
import type { ProjectionGame } from "./types";

/**
 * Directive §3 — single rendering ownership. The event time is owned by the card
 * header (EventHeader); MatchupPanel must NOT repeat it. This test renders the
 * real component tree (no DOM needed — react-dom/server) and asserts the time
 * appears exactly once, which is the exact regression the "3:00 PM ET × 2"
 * screenshot showed. `.test.ts` (not `.tsx`) + createElement so it matches the
 * existing vitest `client/src/**​/*.test.ts` include and needs no JSX runtime.
 */

const country = (name: string, abbr: string, flag: string): ProjectionGame["away"] => ({
  abbr,
  name,
  kind: "country",
  flag,
  logo: null,
  color: null,
  score: null,
});

const side = (marketKey: string, marketLabel: string, sideLabel: string) => ({
  marketKey,
  marketLabel,
  sideLabel,
  bookPrice: null,
  bookOppPrice: null,
  modelPrice: null,
});

/** The Spain vs France semifinal from the directive screenshot. */
function wcFixture(): ProjectionGame {
  return {
    id: "wc-esp-fra",
    league: "World Cup",
    status: "scheduled",
    statusLabel: "3:00 PM ET",
    away: country("Spain", "ESP", "\u{1F1EA}\u{1F1F8}"),
    home: country("France", "FRA", "\u{1F1EB}\u{1F1F7}"),
    matchupContext: "Semifinal · SoFi Stadium (LA), Inglewood",
    venue: "SoFi Stadium (LA), Inglewood",
    markets: [
      {
        key: "dblchc",
        label: "Dbl Chc",
        sides: [
          side("dblchc", "Dbl Chc", "France Win or Draw"),
          side("dblchc", "Dbl Chc", "Spain Win or Draw"),
        ],
      },
      {
        key: "ml",
        label: "Moneyline",
        sides: [side("ml", "Moneyline", "Spain"), side("ml", "Moneyline", "France")],
      },
    ],
  };
}

const render = (game: ProjectionGame): string =>
  renderToStaticMarkup(createElement(ProjectionCard, { game }));

const countOccurrences = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1;

describe("ProjectionCard — single rendering ownership (directive §3)", () => {
  it("renders the event time exactly once per card", () => {
    const html = render(wcFixture());
    expect(countOccurrences(html, "3:00 PM ET")).toBe(1);
  });

  it("keeps the time out of the matchup context line", () => {
    // A FINAL card: the header owns the status; the center owns stage/venue only.
    const game: ProjectionGame = {
      ...wcFixture(),
      status: "final",
      statusLabel: "FINAL",
    };
    const html = render(game);
    expect(countOccurrences(html, "FINAL")).toBe(1);
    expect(html).toContain("Semifinal"); // context still renders
  });

  it("spells out both participants and double-chance labels (§5/§6)", () => {
    const html = render(wcFixture());
    expect(html).toContain("Spain");
    expect(html).toContain("France");
    expect(html).toContain("Spain Win or Draw");
    expect(html).toContain("France Win or Draw");
    // Flags carry the spelled-out country name as their accessible label.
    expect(html).toContain("Spain flag");
    expect(html).toContain("France flag");
  });
});
