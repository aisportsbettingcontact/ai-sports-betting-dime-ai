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
    startTime: "3:00 PM ET",
    markets: [
      {
        key: "dblchc",
        label: "Dbl Chc",
        sides: [
          side("dblchc", "Dbl Chc", "France Win/Draw"),
          side("dblchc", "Dbl Chc", "Spain Win/Draw"),
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

/** The Giants @ Mariners card from the directive screenshot: U 7 carries a
 *  real edge (book -112, model -136) so the summary readout renders. */
function mlbFixture(): ProjectionGame {
  const team = (abbr: string, name: string): ProjectionGame["away"] =>
    ({ abbr, name, logo: null, color: "#333333", score: null });
  return {
    id: "sf-sea",
    league: "MLB",
    status: "scheduled",
    statusLabel: "10:10 PM ET",
    away: team("SF", "Giants"),
    home: team("SEA", "Mariners"),
    matchupContext: "T-Mobile Park",
    venue: "T-Mobile Park", // equals context → the venue line must be suppressed
    startTime: "10:10 PM ET",
    markets: [
      {
        key: "total",
        label: "Total",
        sides: [
          { marketKey: "total", marketLabel: "Total", sideLabel: "O 7", bookPrice: -108, bookOppPrice: -112, modelPrice: 118 },
          { marketKey: "total", marketLabel: "Total", sideLabel: "U 7", bookPrice: -112, bookOppPrice: -108, modelPrice: -136 },
        ],
      },
    ],
  };
}

const render = (game: ProjectionGame): string =>
  renderToStaticMarkup(createElement(ProjectionCard, { game }));

const countOccurrences = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1;

describe("ProjectionCard — single rendering ownership (directive §3)", () => {
  it("renders the event time exactly once per card (matchup block owns it)", () => {
    const html = render(wcFixture());
    expect(countOccurrences(html, "3:00 PM ET")).toBe(1);
  });

  it("header owns LIVE/FINAL status; a final card carries no start time", () => {
    // A FINAL card: the header owns the status; the center owns stage/venue only.
    const game: ProjectionGame = {
      ...wcFixture(),
      status: "final",
      statusLabel: "FINAL",
      startTime: undefined,
    };
    const html = render(game);
    expect(countOccurrences(html, "FINAL")).toBe(1);
    expect(html).toContain("Semifinal"); // context still renders
    expect(html).not.toContain("3:00 PM ET");
  });

  it("spells out both participants and double-chance labels (§5/§6)", () => {
    const html = render(wcFixture());
    expect(html).toContain("Spain");
    expect(html).toContain("France");
    expect(html).toContain("Spain Win/Draw");
    expect(html).toContain("France Win/Draw");
    // Flags carry the spelled-out country name as their accessible label.
    expect(html).toContain("Spain flag");
    expect(html).toContain("France flag");
  });
});

describe("ProjectionCard — no corner league label (owner directive 2026-07-18)", () => {
  it("renders no league label on any card; scheduled cards render no header", () => {
    const scheduled = render(wcFixture());
    expect(scheduled).not.toContain("projection-card__league");
    expect(scheduled).not.toContain("projection-card__head");
    expect(render(mlbFixture())).not.toContain("projection-card__league");
  });

  it("live/final cards keep the status header without a league label", () => {
    const html = render({ ...wcFixture(), status: "final", statusLabel: "FINAL", startTime: undefined });
    expect(html).toContain("projection-card__head");
    expect(html).toContain("FINAL");
    expect(html).not.toContain("projection-card__league");
  });
});

describe("ProjectionCard — matchup block format (owner directive 2026-07-17)", () => {
  it("renders the matchup line with names (countries never show raw codes)", () => {
    const html = render(wcFixture());
    expect(html).toContain("Spain");
    expect(html).toContain("France");
    expect(html).not.toMatch(/\bESP\b|\bFRA\b/);
  });

  it("renders the ballpark exactly once (no duplicate venue line)", () => {
    // venue is contained in the context line, so the venue line is suppressed.
    // Strip title="" tooltip attributes — only VISIBLE text counts as a render.
    const visible = render(wcFixture()).replace(/ title="[^"]*"/g, "");
    expect(countOccurrences(visible, "SoFi Stadium (LA), Inglewood")).toBe(1);
  });

  it("MLB card reads NAME @ NAME / ballpark / first pitch — no abbrs, no pitchers", () => {
    const visible = render(mlbFixture()).replace(/ title="[^"]*"/g, "");
    expect(visible).toContain("Giants");
    expect(visible).toContain("Mariners");
    expect(visible).not.toContain("SF Giants"); // names only in the matchup line
    expect(countOccurrences(visible, "T-Mobile Park")).toBe(1);
    expect(countOccurrences(visible, "10:10 PM ET")).toBe(1);
  });

  it("spells out the MODEL EDGE pick and labels the readout BOOK", () => {
    // U 7 carries the edge (book -112 vs model -136, the directive screenshot).
    const html = render(mlbFixture());
    expect(html).toContain('summary__pick">Under 7<');
    expect(html).toContain(">Book<");
    expect(html).not.toContain("Best price");
  });

  it("labels market columns BOOK / MODEL and offers the projections disclosure", () => {
    const html = render(wcFixture());
    expect(html).toContain(">Book<");
    expect(html).toContain(">Model<");
    expect(html).not.toMatch(/Sportsbook price|Model fair price/);
    expect(html).toContain("View full AI model projections");
  });
});
