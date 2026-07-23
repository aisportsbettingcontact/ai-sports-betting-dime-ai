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

/** Dodgers @ Yankees with TWO real edges (the 2026-07-18 directive screenshot):
 *  Yankees ML +9.1pp (book -105, model -152) outranks Under 9 +7.6pp (book
 *  -115, model -157); the run line is dead even (no edge). Labels arrive
 *  pre-spelled from the presentation layer ("Yankees ML", "Under 9"). */
function multiEdgeFixture(): ProjectionGame {
  const team = (abbr: string, name: string): ProjectionGame["away"] =>
    ({ abbr, name, logo: null, color: "#333333", score: null });
  return {
    id: "lad-nyy",
    league: "MLB",
    status: "scheduled",
    statusLabel: "7:05 PM ET",
    away: team("LAD", "Dodgers"),
    home: team("NYY", "Yankees"),
    matchupContext: "Yankee Stadium",
    venue: "Yankee Stadium",
    startTime: "7:05 PM ET",
    markets: [
      {
        key: "run-line",
        label: "Run Line",
        sides: [
          { marketKey: "run-line", marketLabel: "Run Line", sideLabel: "Dodgers -1.5", bookPrice: 140, bookOppPrice: -170, modelPrice: 140 },
          { marketKey: "run-line", marketLabel: "Run Line", sideLabel: "Yankees +1.5", bookPrice: -170, bookOppPrice: 140, modelPrice: -170 },
        ],
      },
      {
        key: "total",
        label: "Total",
        sides: [
          { marketKey: "total", marketLabel: "Total", sideLabel: "Over 9", bookPrice: -105, bookOppPrice: -115, modelPrice: 130 },
          { marketKey: "total", marketLabel: "Total", sideLabel: "Under 9", bookPrice: -115, bookOppPrice: -105, modelPrice: -157 },
        ],
      },
      {
        key: "moneyline",
        label: "Moneyline",
        sides: [
          { marketKey: "moneyline", marketLabel: "Moneyline", sideLabel: "Dodgers ML", bookPrice: -115, bookOppPrice: -105, modelPrice: 152 },
          { marketKey: "moneyline", marketLabel: "Moneyline", sideLabel: "Yankees ML", bookPrice: -105, bookOppPrice: -115, modelPrice: -152 },
        ],
      },
    ],
  };
}

describe("ProjectionCard — ranked edge carousel (owner directive 2026-07-18)", () => {
  it("2+ edges render the swipe strip, strongest first, weakest last", () => {
    const html = render(multiEdgeFixture());
    expect(html).toContain("summary-carousel");
    expect(countOccurrences(html, "summary-carousel__slide")).toBe(2);
    // Ranked: Yankees ML (+9.1pp) leads, Under 9 (+7.6pp) closes the strip.
    expect(html.indexOf("Yankees ML")).toBeGreaterThan(-1);
    expect(html.indexOf("Yankees ML")).toBeLessThan(html.indexOf("Under 9"));
    expect(html).toContain("Edge 1 of 2");
  });

  it("no-edge markets never populate a slide (run line stays out)", () => {
    const html = render(multiEdgeFixture());
    // Slides are labeled with their pick; the dead-even run line gets none.
    expect(html).not.toContain("of 2: Dodgers -1.5");
    expect(html).not.toContain("of 2: Yankees +1.5");
    // Exact-class match: the "__dots" wrapper contains "__dot" as a substring.
    expect(countOccurrences(html, 'class="summary-carousel__dot"')).toBe(2);
  });

  it("a single-edge card keeps the plain summary — no carousel chrome", () => {
    const html = render(mlbFixture());
    expect(html).not.toContain("summary-carousel");
    expect(html).toContain('summary__pick">Under 7<');
  });

  it("the moneyline edge readout carries the market: 'Yankees ML', never bare 'Yankees'", () => {
    const html = render(multiEdgeFixture());
    expect(html).toContain('summary__pick">Yankees ML<');
    expect(html).not.toContain('summary__pick">Yankees<');
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

/** Round 4 Wave 1 — card anatomy (docs/superpowers/plans/2026-07-23-feed-desktop-polish.md,
 *  items 2/3/4; law: design-system/dime-ai/pages/ai-model-projections.md). These pin the
 *  RENDERED STRUCTURE (class names, DOM order) that the desktop/tablet-scoped CSS in
 *  ProjectionCard.css hooks — the actual 24px/opacity/mint-on-light/pulse values are CSS,
 *  verified separately by the visual smoke screenshots, not by this DOM-only harness. */
describe("ProjectionCard — unified score row (Round 4 Wave 1, item 2)", () => {
  /** A live/final game: both scores present, so MatchupPanel's showScore branch fires. */
  function scoredFixture(): ProjectionGame {
    const team = (abbr: string, name: string, score: number): ProjectionGame["away"] =>
      ({ abbr, name, logo: null, color: "#333333", score });
    return {
      id: "lad-nyy-final",
      league: "MLB",
      status: "final",
      statusLabel: "FINAL",
      away: team("LAD", "Dodgers", 4),
      home: team("NYY", "Yankees", 2),
      matchupContext: "Yankee Stadium",
      venue: "Yankee Stadium",
      markets: [],
    };
  }

  it("renders away logo/score, the matchup line, and home score/logo on one optical row", () => {
    const html = render(scoredFixture());
    // Both scores render via the same tabular-nums score class.
    expect(html.match(/class="matchup__score score-value"/g)).toHaveLength(2);
    // DOM order: away score, THEN the "Dodgers @ Yankees" center line, THEN home score —
    // the exact away-logo·away-score·"Away @ Home"·home-score·home-logo sequence.
    const awayScoreIdx = html.indexOf(">4<");
    const centerIdx = html.indexOf("matchup__center");
    const homeScoreIdx = html.indexOf(">2<");
    expect(awayScoreIdx).toBeGreaterThan(-1);
    expect(awayScoreIdx).toBeLessThan(centerIdx);
    expect(centerIdx).toBeLessThan(homeScoreIdx);
  });

  it("scheduled games (no score) keep the current layout — no score row at all", () => {
    const html = render(mlbFixture());
    expect(html).not.toContain("matchup__score");
  });
});

describe("ProjectionCard — PASS-card law (Round 4 Wave 1, item 3)", () => {
  /** A game with a real market but neither side clears the WATCH threshold —
   *  a genuine whole-card PASS (edgePP well under 1.5pp both sides). */
  function passFixture(): ProjectionGame {
    const team = (abbr: string, name: string): ProjectionGame["away"] =>
      ({ abbr, name, logo: null, color: "#333333", score: null });
    return {
      id: "oak-tex",
      league: "MLB",
      status: "scheduled",
      statusLabel: "7:05 PM ET",
      away: team("OAK", "Athletics"),
      home: team("TEX", "Rangers"),
      matchupContext: "Globe Life Field",
      venue: "Globe Life Field",
      startTime: "7:05 PM ET",
      markets: [
        {
          key: "moneyline",
          label: "Moneyline",
          sides: [
            { marketKey: "moneyline", marketLabel: "Moneyline", sideLabel: "Athletics ML", bookPrice: -110, bookOppPrice: -110, modelPrice: -110 },
            { marketKey: "moneyline", marketLabel: "Moneyline", sideLabel: "Rangers ML", bookPrice: -110, bookOppPrice: -110, modelPrice: -110 },
          ],
        },
      ],
    };
  }

  it("carries the projection-card--pass modifier when no market clears the edge threshold", () => {
    expect(render(passFixture())).toContain("projection-card--pass");
    expect(render(mlbFixture())).not.toContain("projection-card--pass"); // Under 7 IS a real edge
  });

  it("uses the SAME structured summary grid as an edge card — no divergent bare <p>", () => {
    const html = render(passFixture());
    expect(html).toContain("summary__readout");
    expect(html).toContain("Every market is efficiently priced. No action.");
    // The message is now a <dd> inside the grid's value row, never a standalone <p>.
    expect(html).not.toMatch(/<p class="summary__none/);
    expect(html).toMatch(/<dd class="summary__none[^"]*">Every market is efficiently priced\. No action\.<\/dd>/);
  });

  it("renders zero mint signal anywhere on a genuine PASS card", () => {
    const html = render(passFixture());
    expect(html).toContain("edge-indicator--none"); // "No edge" occupies the chip slot
    expect(html).not.toContain('"edge-indicator summary__edge"'); // the signal (mint) variant never appears
    expect(html).not.toContain("market-table__model--signal");
    expect(html).not.toContain("market-table__result--edge");
  });
});

describe("ProjectionCard — live indicator (Round 4 Wave 1, item 4)", () => {
  it("a live card renders the pulsing dot beside the status label", () => {
    const html = render({ ...wcFixture(), status: "live", statusLabel: "LIVE · TOP 5TH", startTime: undefined });
    expect(html).toContain("projection-card__live-dot");
    expect(html).toContain("projection-card__status--live");
    expect(html).toContain("LIVE · TOP 5TH");
    // The dot precedes the label text inside the same status span.
    expect(html.indexOf("projection-card__live-dot")).toBeLessThan(html.indexOf("LIVE · TOP 5TH"));
  });

  it("final and scheduled cards never render the live dot", () => {
    const final = render({ ...wcFixture(), status: "final", statusLabel: "FINAL", startTime: undefined });
    expect(final).not.toContain("projection-card__live-dot");
    const scheduled = render(wcFixture());
    expect(scheduled).not.toContain("projection-card__live-dot");
  });
});
