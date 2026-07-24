import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "fs";
import path from "path";
import { MarketTable } from "./MarketTable";
import { ProjectionCard } from "./ProjectionCard";
import {
  marketPaginationItems,
  projectionMarketPage,
} from "./ProjectionMarketsPopover";
import { clampActiveEdgeIndex } from "./SummaryCarousel";
import type { ProjectionGame } from "./types";

/** Round 4 Wave 2 (items 1, 5) source-contract fixtures — CSS/markup are read
 *  raw so these assertions pin the actual rules the visual smoke screenshots
 *  verify, without a browser/CSSOM in this vitest environment (same pattern
 *  as the W1 DOM-only harness note below). */
const cardCss = fs.readFileSync(path.join(import.meta.dirname, "ProjectionCard.css"), "utf8");
const edgeIndicatorCss = fs.readFileSync(path.join(import.meta.dirname, "EdgeIndicator.css"), "utf8");
const summaryCarouselSrc = fs.readFileSync(path.join(import.meta.dirname, "SummaryCarousel.tsx"), "utf8");
const marketPopoverSrc = fs.readFileSync(
  path.join(import.meta.dirname, "ProjectionMarketsPopover.tsx"),
  "utf8",
);
const feedSrc = fs.readFileSync(
  path.join(import.meta.dirname, "..", "..", "pages", "DimeModelFeed.tsx"),
  "utf8",
);
const lawDoc = fs.readFileSync(
  path.join(import.meta.dirname, "..", "..", "..", "..", "design-system", "dime-ai", "pages", "ai-model-projections.md"),
  "utf8",
);

/** Slice the CSS source between two heading comments (exclusive of the second). */
function cssBlock(src: string, startMarker: string, endMarker: string): string {
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`CSS anchors changed: "${startMarker}" / "${endMarker}"`);
  return src.slice(start, end);
}

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
        key: "runline",
        label: "Run Line",
        sides: [
          {
            marketKey: "runline",
            marketLabel: "Run Line",
            sideLabel: "Giants +1.5",
            bookPrice: null,
            bookOppPrice: null,
            modelPrice: null,
          },
          {
            marketKey: "runline",
            marketLabel: "Run Line",
            sideLabel: "Mariners -1.5",
            bookPrice: null,
            bookOppPrice: null,
            modelPrice: null,
          },
        ],
      },
      {
        key: "total",
        label: "Total",
        sides: [
          { marketKey: "total", marketLabel: "Total", sideLabel: "O 7", bookPrice: -108, bookOppPrice: -112, modelPrice: 118 },
          { marketKey: "total", marketLabel: "Total", sideLabel: "U 7", bookPrice: -112, bookOppPrice: -108, modelPrice: -136 },
        ],
      },
      {
        key: "moneyline",
        label: "Moneyline",
        sides: [
          {
            marketKey: "moneyline",
            marketLabel: "Moneyline",
            sideLabel: "Giants ML",
            bookPrice: null,
            bookOppPrice: null,
            modelPrice: null,
          },
          {
            marketKey: "moneyline",
            marketLabel: "Moneyline",
            sideLabel: "Mariners ML",
            bookPrice: null,
            bookOppPrice: null,
            modelPrice: null,
          },
        ],
      },
    ],
  };
}

function mlbPregameFixture(): ProjectionGame {
  return {
    ...mlbFixture(),
    pregameLineups: {
      source: "Rotowire",
      scrapedAt: 1_721_740_000_000,
      away: {
        pitcher: {
          name: "Logan Webb",
          hand: "R",
          seasonStats: "7-4 · 3.21 ERA",
          rotowireId: 14222,
          mlbamId: 657277,
          confirmed: true,
        },
        confirmed: true,
        battingOrder: [
          {
            battingOrder: 1,
            position: "CF",
            name: "Jung Hoo Lee",
            bats: "L",
            rotowireId: 18043,
            mlbamId: 808982,
          },
        ],
      },
      home: {
        pitcher: {
          name: "George Kirby",
          hand: "R",
          seasonStats: "8-5 · 3.62 ERA",
          rotowireId: 15669,
          mlbamId: 669923,
          confirmed: false,
        },
        confirmed: false,
        battingOrder: [],
      },
    },
  };
}

const render = (game: ProjectionGame): string =>
  renderToStaticMarkup(createElement(ProjectionCard, { game }));

const renderMarket = (game: ProjectionGame, marketIndex = 0): string => {
  const market = game.markets[marketIndex];
  if (!market)
    throw new Error(`Missing market fixture at index ${marketIndex}`);
  return renderToStaticMarkup(createElement(MarketTable, { market }));
};

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

  it("spells out both participants and the paged market labels (§5/§6)", () => {
    const html = render(wcFixture());
    const marketHtml = renderMarket(wcFixture());
    expect(html).toContain("Spain");
    expect(html).toContain("France");
    expect(marketHtml).toContain("Spain Win/Draw");
    expect(marketHtml).toContain("France Win/Draw");
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
  it("keeps one arrow keyboard-reachable when a live edge list shrinks", () => {
    expect(clampActiveEdgeIndex(2, 3)).toBe(2);
    expect(clampActiveEdgeIndex(2, 2)).toBe(1);
    expect(clampActiveEdgeIndex(2, 0)).toBe(0);
  });

  it("2+ edges render the swipe strip, strongest first, weakest last", () => {
    const html = render(multiEdgeFixture());
    expect(html).toContain("summary-carousel");
    expect(countOccurrences(html, "summary-carousel__slide")).toBe(2);
    // Ranked: Yankees ML (+9.1pp) leads, Under 9 (+7.6pp) closes the strip.
    expect(html.indexOf("Yankees ML")).toBeGreaterThan(-1);
    expect(html.indexOf("Yankees ML")).toBeLessThan(html.indexOf("Under 9"));
    expect(countOccurrences(html, 'class="summary__next"')).toBe(2);
    expect(html).toContain("lucide-arrow-right");
    expect(html).toContain("View next model edge: Under 9 (2 of 2)");
  });

  it("no-edge markets stay out and the old visible count/dot chrome is gone", () => {
    const html = render(multiEdgeFixture());
    // Slides are labeled with their pick; the dead-even run line gets none.
    expect(html).not.toContain("of 2: Dodgers -1.5");
    expect(html).not.toContain("of 2: Yankees +1.5");
    expect(html).not.toContain("summary-carousel__nav");
    expect(html).not.toContain("summary-carousel__count");
    expect(html).not.toContain("summary-carousel__dot");
  });

  it("a single-edge card keeps the plain summary with no carousel arrow", () => {
    const html = render(mlbFixture());
    expect(html).not.toContain("summary-carousel");
    expect(html).not.toContain("summary__next");
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

  it("labels market columns BOOK / MODEL and offers the projections popover", () => {
    const html = render(wcFixture());
    const marketHtml = renderMarket(wcFixture());
    expect(marketHtml).toContain(">Book<");
    expect(marketHtml).toContain(">Model<");
    expect(marketHtml).not.toMatch(/Sportsbook price|Model fair price/);
    expect(html).toContain("View full AI model projections");
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toContain("<details");
  });
});

describe("ProjectionCard — paginated market popover", () => {
  it("shows all three MLB market pages in source order", () => {
    expect(mlbFixture().markets.map(market => market.label)).toEqual([
      "Run Line",
      "Total",
      "Moneyline",
    ]);
    expect(marketPaginationItems(0, 3)).toEqual([0, 1, 2]);
    expect(marketPaginationItems(1, 3)).toEqual([0, 1, 2]);
    expect(marketPaginationItems(2, 3)).toEqual([0, 1, 2]);
  });

  it("keeps larger World Cup slates reachable with a compact ellipsis window", () => {
    const baseMarket = wcFixture().markets[0];
    const markets = Array.from({ length: 7 }, (_, index) => ({
      ...baseMarket,
      key: `market-${index + 1}`,
      label: `Market ${index + 1}`,
    }));

    for (let page = 0; page < markets.length; page += 1) {
      expect(projectionMarketPage(markets, page)).toEqual({
        activePage: page,
        activeMarket: markets[page],
      });
    }
    expect(
      Array.from(
        new Set(
          markets.flatMap((_, page) =>
            marketPaginationItems(page, markets.length).filter(
              (item): item is number => typeof item === "number"
            )
          )
        )
      ).sort((a, b) => a - b)
    ).toEqual([0, 1, 2, 3, 4, 5, 6]);

    expect(marketPaginationItems(0, 7)).toEqual([0, 1, 2, "ellipsis-end", 6]);
    expect(marketPaginationItems(3, 7)).toEqual([
      0,
      "ellipsis-start",
      3,
      "ellipsis-end",
      6,
    ]);
    expect(marketPaginationItems(6, 7)).toEqual([0, "ellipsis-start", 4, 5, 6]);
  });

  it("binds the actual popover to the complete dynamic market list", () => {
    expect(marketPopoverSrc).toContain(
      "projectionMarketPage(\n    game.markets,\n    requestedPage"
    );
    expect(marketPopoverSrc).toContain(
      "marketPaginationItems(activePage, marketCount)"
    );
    expect(marketPopoverSrc).toContain("<MarketTable market={activeMarket} />");
    expect(marketPopoverSrc).not.toMatch(/markets\.(?:slice|splice)\(/);
  });

  it("uses theme-safe portal tokens and remains scroll-contained", () => {
    const popoverCss = cssBlock(
      cardCss,
      "The portal is outside",
      "Market table — flat"
    );
    expect(popoverCss).toContain("background: var(--popover, #141414);");
    expect(popoverCss).toContain("color: var(--popover-foreground, #fff);");
    expect(popoverCss).toContain(
      "max-block-size: min(34rem, var(--radix-popover-content-available-height));"
    );
    expect(popoverCss).toContain("overflow-y: auto;");
    expect(popoverCss).toMatch(
      /html:not\(\.dark\) \.projection-card__markets-eyebrow \{\s*color: #0fa36b;/
    );
  });

  it("renders no empty popover trigger when a game has no markets", () => {
    const html = render({ ...mlbFixture(), markets: [] });
    expect(html).not.toContain("projection-card__markets-toggle");
    expect(marketPaginationItems(0, 0)).toEqual([]);
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
    expect(cardCss).toMatch(
      /\.matchup__grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto minmax\(0, 1fr\);/,
    );
    expect(cardCss).toContain(".matchup__team--away { justify-content: flex-end; }");
    expect(cardCss).toContain(".matchup__team--home { justify-content: flex-start; }");
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

describe("ProjectionCard — Rotowire pregame context", () => {
  it("shows both probable pitchers and the centered LINEUPS trigger on scheduled MLB cards", () => {
    const html = render(mlbPregameFixture());
    expect(html).toContain("projection-card--with-pregame");
    expect(html).toContain('aria-label="Probable pitchers"');
    expect(html).toContain("Logan Webb");
    expect(html).toContain("7-4 · 3.21 ERA");
    expect(html).toContain("George Kirby");
    expect(html).toContain("8-5 · 3.62 ERA");
    expect(html).toContain(">Confirmed<");
    expect(html).toContain(">Expected<");
    expect(html).toContain(">Lineups<");
    expect(html).toContain("View lineups for Giants at Mariners");
    expect(html).toContain('data-headshot-source="mlb"');
  });

  it("precisely top-centers headshots and renders LINEUPS as the mint, black, 44px CTA", () => {
    expect(cardCss).toMatch(
      /\.pregame-pitcher__photo\s*\{[^}]*place-items:\s*start center;/,
    );
    expect(cardCss).toMatch(
      /\.pregame-pitcher__photo img\[data-headshot-source="mlb"\]\s*\{[^}]*object-fit:\s*contain;[^}]*object-position:\s*center top;[^}]*transform:\s*scale\(0\.82\);[^}]*transform-origin:\s*center top;/,
    );
    expect(cardCss).toMatch(
      /\.pregame-pitcher__photo img\[data-headshot-source="rotowire"\]\s*\{[^}]*object-fit:\s*cover;[^}]*object-position:\s*center;[^}]*transform:\s*scale\(0\.9\);[^}]*transform-origin:\s*center;/,
    );
    expect(cardCss).toMatch(
      /\.pregame-pitchers__lineups\s*\{[^}]*min-block-size:\s*44px;[^}]*color:\s*#000;[^}]*background:\s*#45e0a8;[^}]*border-radius:\s*12px;/,
    );
    expect(cardCss).toMatch(
      /\.pregame-pitchers__lineups:active\s*\{\s*transform:\s*scale\(0\.98\);\s*\}/,
    );
  });

  it("never renders stale pregame data after a game becomes live, final, or postponed", () => {
    for (const status of ["live", "final", "postponed"] as const) {
      const html = render({
        ...mlbPregameFixture(),
        status,
        statusLabel: status === "live" ? "LIVE · TOP 1ST" : status.toUpperCase(),
        startTime: undefined,
      });
      expect(html).toContain(`projection-card--${status}`);
      expect(html).toContain("projection-card--compact");
      expect(html).not.toContain("projection-card--with-pregame");
      expect(html).not.toContain("Logan Webb");
      expect(html).not.toContain(">Lineups<");
    }
  });

  it("pins compact cards to their natural height and applies the diminished treatment", () => {
    expect(cardCss).toMatch(/\.projection-card--compact\s*\{[\s\S]*?align-self:\s*start;/);
    expect(cardCss).toMatch(/\.projection-card--compact\s*\{[\s\S]*?opacity:\s*0\.72;/);
    expect(cardCss).toMatch(
      /\.projection-card--scheduled\.projection-card--with-pregame\s*\{[\s\S]*?grid-template-areas:\s*"matchup"\s*"pregame"\s*"summary"\s*"markets";/,
    );
  });
});

/** Round 4 Wave 2 (docs/superpowers/plans/2026-07-23-feed-desktop-polish.md, items 1/5;
 *  law: design-system/dime-ai/pages/ai-model-projections.md). Item 1 (equal-height rows,
 *  pinned market trigger) and item 5 (fixed-track summary alignment) are CSS-Grid contracts with
 *  no new DOM nodes, so — same as W1's note above — the structural proof here is (a) the DOM
 *  hooks the CSS keys off (class names) and (b) reading the actual CSS/markup source for the
 *  numeric contract itself; the rendered pixels are verified separately by the visual smoke
 *  screenshots (equal row heights, pinned trigger, aligned columns), not by this harness. */
describe("ProjectionCard — equal-height rows & pinned market trigger (Round 4 Wave 2, item 1)", () => {
  it("the responsive league grid is 2-across on tablet and 3-across with stretched row-mates on desktop", () => {
    const responsiveGridBlock = feedSrc.slice(
      feedSrc.indexOf("TABLET (768-1023px)"),
      feedSrc.indexOf("@media (prefers-reduced-motion: reduce){", feedSrc.indexOf("TABLET (768-1023px)")),
    );
    expect(responsiveGridBlock).toMatch(
      /@media \(min-width:768px\)\{\s*\.dmf-leaguebody\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/,
    );
    expect(responsiveGridBlock).toMatch(
      /@media \(min-width:1024px\)\{[\s\S]*?\.dmf-leaguebody\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\);align-items:stretch\}/,
    );
  });

  it("the law doc records the 1/2/3 responsive density contract and desktop stretch behavior", () => {
    const section = lawDoc.slice(
      lawDoc.indexOf("Owner Directives — 2026-07-23 (responsive feed density)"),
      lawDoc.indexOf("Owner Directives — 2026-07-18 (edge labeling"),
    );
    expect(section).toContain("mobile (<768px) renders 1");
    expect(section).toContain("tablet (768–1023px) renders");
    expect(section).toContain("desktop (>=1024px) renders 3");
    expect(section).toContain("Desktop rows stretch");
  });

  it("desktop->=1024px CSS gives the card a flexible summary row so surplus height centers there, trigger pinned last", () => {
    const item1 = cssBlock(cardCss, "Round 4 Wave 2 — item 1", "── Summary carousel");
    expect(item1).toContain("@media (min-width: 1024px)");
    // grid-template-areas order is head/matchup/summary/markets (scheduled drops head) —
    // the row-track list must line up 1:1: fixed, fixed, 1fr (surplus absorber), fixed (pinned last).
    expect(item1).toMatch(/\.projection-card\s*\{\s*grid-template-rows:\s*auto auto 1fr auto;\s*\}/);
    expect(item1).toMatch(/\.projection-card--scheduled\s*\{\s*grid-template-rows:\s*auto 1fr auto;\s*\}/);
    // The carousel variant of the summary area also centers in its surplus row.
    expect(item1).toMatch(/\.summary-carousel\s*\{\s*align-content:\s*center;\s*\}/);
  });

  it("item 1's grid-template-rows rule is NOT present outside the >=1024px block (desktop-only, item 8 scoping)", () => {
    const beforeItem1 = cardCss.slice(0, cardCss.indexOf("Round 4 Wave 2 — item 1"));
    expect(beforeItem1).not.toMatch(/grid-template-rows:\s*auto auto 1fr auto/);
  });
});

describe("ProjectionCard — aligned summary mini-grid (Round 4 Wave 2, item 5)", () => {
  it("an edge card's readout carries the fixed-track modifier classes (edge/book/model)", () => {
    const html = render(mlbFixture());
    expect(html).toContain('class="summary__item summary__item--edge"');
    expect(html).toContain('class="summary__item summary__item--book"');
    expect(html).toContain('class="summary__item summary__item--model"');
  });

  it("a PASS card's message item spans the value columns (W1 structure preserved)", () => {
    const passHtml = render({
      ...mlbFixture(),
      id: "oak-tex-pass",
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
    });
    expect(passHtml).toContain("projection-card--pass");
    expect(passHtml).toContain('class="summary__item summary__item--message"');
    expect(passHtml).not.toContain("summary__item--edge");
    expect(passHtml).not.toContain("summary__item--book");
  });

  it("desktop+tablet (>=768px) CSS gives the readout fixed, non-content-sized column tracks", () => {
    const item5 = cssBlock(cardCss, "Round 4 Wave 2 — item 5", "Round 4 Wave 2 — item 1");
    expect(item5).toContain("@media (min-width: 768px)");
    expect(item5).toContain("display: grid");
    // Every track is fixed — never `auto`/`max-content`,
    // which would size the column from that card's own content and break alignment.
    expect(item5).toContain("grid-template-columns: 112px 48px 48px 168px;");
    expect(item5).not.toMatch(/grid-template-columns:[^;]*\bauto\b/);
    expect(item5).toContain(".summary__readout { display: contents; }");
    expect(item5).toContain(".summary__item--edge { grid-column: 1; }");
    expect(item5).toContain(".summary__item--book { grid-column: 2; }");
    expect(item5).toContain(".summary__item--model { grid-column: 3; }");
    expect(item5).toContain(".summary__item--edge .summary__pick { font-size: var(--proj-label); }");
    expect(item5).toContain(".summary__item--message { grid-column: 1 / span 3; }");
    // The chip (real edge OR the "No edge" quiet variant) always lands in the last track —
    // PASS cards' "No edge" slot keeps the same alignment a real edge chip would have.
    expect(item5).toContain(".summary__signal { grid-column: 4; justify-self: start; }");
  });

  it("the readout uses the compact 400px rhythm and reflows before it can overflow", () => {
    const item5 = cssBlock(cardCss, "Round 4 Wave 2 — item 5", "Round 4 Wave 2 — item 1");
    expect(item5).toContain("grid-template-columns: 112px 48px 48px 168px;");
    expect(item5).toContain("column-gap: 8px;");
    expect(item5).toContain("@container projcard (max-width: 400px)");
    expect(item5).toMatch(/\.summary \{[^}]*min-inline-size: 0;/);
  });

  it("reflows the summary by card width when a 3-across desktop column is narrow", () => {
    const item5 = cssBlock(cardCss, "Round 4 Wave 2 — item 5", "Round 4 Wave 2 — item 1");
    expect(item5).toContain("@container projcard (max-width: 400px)");
    expect(item5).toMatch(
      /\.summary__readout \{\s*display: grid;\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/,
    );
    expect(item5).toContain(".summary__item--edge { grid-column: 1 / -1; }");
    expect(item5).toContain(".summary__item--edge .summary__pick { font-size: var(--proj-body); }");
    expect(item5).toContain(".summary__item--message { grid-column: 1 / -1; }");
    expect(item5).toContain(".summary__signal { grid-column: auto; align-self: center; justify-self: auto; }");
  });

  it("the multi-edge next control is mint with a theme foreground border and 44px target", () => {
    expect(cardCss).toMatch(
      /\.summary__next\s*\{[^}]*inline-size:\s*44px;[^}]*block-size:\s*44px;[^}]*color:\s*#45e0a8;[^}]*border:\s*1px solid var\(--foreground, #fff\);/,
    );
  });

  it("compacts the pill, never the 44px arrow, on the narrowest desktop cards", () => {
    const narrowSignal = cardCss.slice(
      cardCss.indexOf("On the narrowest three-across desktop cards"),
      cardCss.indexOf("── Markets popover"),
    );
    expect(narrowSignal).toContain("@container projcard (max-width: 280px)");
    expect(narrowSignal).toContain(".projection-card .summary__signal { gap: 4px; max-inline-size: 100%; }");
    expect(narrowSignal).toMatch(
      /\.projection-card \.summary__signal \.edge-indicator\s*\{[^}]*padding:\s*0\.25rem 0\.375rem;/,
    );
    expect(narrowSignal).not.toContain(".summary__next {");
    expect(cardCss).toMatch(/\.summary-carousel__slide\s*\{[^}]*overflow:\s*hidden;/);
  });

  it("numeric readout cells are tabular (Book/Model values, the edge chip's percentage)", () => {
    const item5 = cssBlock(cardCss, "Round 4 Wave 2 — item 5", "Round 4 Wave 2 — item 1");
    expect(item5).toMatch(/\.summary__item--book \.odds-value,\s*\n\s*\.summary__item--model \.odds-value,\s*\n\s*\.edge-indicator__value\s*\{\s*\n\s*font-variant-numeric:\s*tabular-nums;/);
  });

  it("item 5's mini-grid is scoped to >=768px only (mobile stays the W1 flex layout, byte-untouched)", () => {
    const beforeItem5 = cardCss.slice(0, cardCss.indexOf("Round 4 Wave 2 — item 5"));
    // The unconditional (mobile-first) `.summary` rule is still the flex layout.
    expect(beforeItem5).toMatch(/\.summary\s*\{\s*grid-area:\s*summary;\s*display:\s*flex;/);
  });

  it("ONE canonical edge-chip style: EdgeIndicator is the sole chip implementation, no divergent variant", () => {
    // The mint chip is styled exactly once (plus its --none quiet counterpart) in EdgeIndicator.css.
    expect((edgeIndicatorCss.match(/^\.edge-indicator \{/gm) ?? []).length).toBe(1);
    expect((edgeIndicatorCss.match(/^\.edge-indicator--none \{/gm) ?? []).length).toBe(1);
    // SummaryCarousel (the multi-edge surface) delegates to ProjectionSummary/EdgeIndicator for
    // every slide rather than re-implementing its own chip markup.
    expect(summaryCarouselSrc).not.toMatch(/edge-indicator/);
    expect(summaryCarouselSrc).toContain("ProjectionSummary");
    // Rendered output only ever uses the two canonical chip classes — never an alternate
    // "chip"-named class that would diverge from the shipped mint-outline style.
    const edgeHtml = render(mlbFixture());
    const passHtml = render({
      ...mlbFixture(),
      id: "oak-tex-pass-2",
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
    });
    expect(edgeHtml).toMatch(/class="edge-indicator summary__edge"/);
    expect(passHtml).toMatch(/class="edge-indicator--none summary__edge"/);
    expect(edgeHtml + passHtml).not.toMatch(/class="[^"]*\bchip\b[^"]*"/i);
  });
});

/** Round 4 Wave 3 (docs/superpowers/plans/2026-07-23-feed-desktop-polish.md, item 7 +
 *  the W1-review fold-in minors; law: design-system/dime-ai/pages/ai-model-projections.md).
 *  Same DOM-only-harness note as W1/W2 above: hover fills and transitions are CSS, verified
 *  by reading the actual stylesheet source (what the visual smoke's forced :hover screenshot
 *  proves) rather than by a CSSOM this vitest environment doesn't have. */
describe("ProjectionCard — market-trigger hover (Round 4 Wave 3, item 7)", () => {
  it("the toggle gets the shell row-hover fill on the 160ms brand curve, hover-capable + >=768px only", () => {
    const item7 = cssBlock(cardCss, "Round 4 Wave 3 — item 7", "The portal is outside");
    expect(item7).toContain("@media (min-width: 768px) and (hover: hover)");
    expect(item7).toMatch(
      /\.projection-card__markets-toggle:hover \{ background: var\(--row-hover, #141414\); color: var\(--foreground, #fff\); \}/,
    );
  });

  it("the transition (160ms brand curve, same cubic-bezier as MASTER.md's motion law) lives inside the same gate as the hover fill (item 8 audit-fix)", () => {
    const item7 = cssBlock(cardCss, "Round 4 Wave 3 — item 7", "The portal is outside");
    expect(item7).toMatch(
      /\.projection-card__markets-toggle \{\s*\n\s*transition: background 160ms cubic-bezier\(0\.16, 1, 0\.3, 1\), color 160ms cubic-bezier\(0\.16, 1, 0\.3, 1\);/,
    );
    // Not present on the unconditional base rule (audit-fix: it was there in
    // an earlier draft, inert but out of scope below 768px/on touch-only).
    const baseRule = cardCss.slice(
      cardCss.indexOf(".projection-card__markets-toggle {"),
      cardCss.indexOf("}", cardCss.indexOf(".projection-card__markets-toggle {")),
    );
    expect(baseRule).not.toContain("transition:");
  });

  it("cursor:pointer and the label/panel-icon markup stay tappable at every breakpoint", () => {
    // Base rule is unconditional: the popover button is tappable everywhere,
    // not just on hover-capable desktop/tablet.
    expect(cardCss).toMatch(/\.projection-card__markets-toggle \{[^}]*cursor: pointer;/);
    expect(render(mlbFixture())).toContain("View full AI model projections");
    expect(render(mlbFixture())).toContain("projection-card__markets-icon");
    expect(render(mlbFixture())).not.toContain("projection-card__markets-chev");
    expect(render(mlbFixture())).not.toContain("<summary");
  });

  it("no bare unconditional :hover rule remains outside the gated media query (no stuck touch-hover)", () => {
    const beforeItem7 = cardCss.slice(0, cardCss.indexOf("Round 4 Wave 3 — item 7"));
    expect(beforeItem7).not.toMatch(/\.projection-card__markets-toggle:hover/);
  });
});

describe("ProjectionCard — defensive PASS-mint backstop (Round 4 Wave 3 fold-in, W1 review)", () => {
  it("neutralizes market-table signal/edge classes and the real edge-indicator variant under .projection-card--pass", () => {
    const backstop = cssBlock(cardCss, "Defensive PASS backstop (Round 4, from the W1 review", "Item 4 — live indicator");
    expect(backstop).toContain(".projection-card--pass .market-table__model--signal,");
    expect(backstop).toContain(".projection-card--pass .market-table__result--edge,");
    expect(backstop).toContain(".projection-card__markets-popover--pass .market-table__model--signal,");
    expect(backstop).toContain(".projection-card__markets-popover--pass .market-table__result--edge,");
    expect(backstop).toContain(".projection-card--pass .edge-indicator {");
    expect(backstop).toMatch(/color: var\(--text-secondary, #a6a6a6\) !important;/);
    expect(backstop).toMatch(/background: transparent !important;/);
  });

  it("covers the edge chip's inline-styled icon (author !important beats inline; review fix)", () => {
    // EdgeIndicator.tsx sets the recommendation icon's mint color as an
    // inline style, which the ancestor backstop rule can never reach — the
    // svg needs its own !important declaration.
    const backstop = cssBlock(cardCss, "Defensive PASS backstop (Round 4, from the W1 review", "Item 4 — live indicator");
    expect(backstop).toContain(".projection-card--pass .edge-indicator svg {");
    const svgRule = backstop.slice(backstop.indexOf(".projection-card--pass .edge-indicator svg {"));
    expect(svgRule).toMatch(/color: var\(--text-secondary, #a6a6a6\) !important;/);
  });

  it("is scoped inside the same >=768px block as the rest of items 2-4 (item 8 scoping)", () => {
    const item234 = cssBlock(cardCss, "Round 4 Wave 1 — desktop/tablet card-anatomy", "Round 4 Wave 2 — item 5");
    expect(item234).toContain("@media (min-width: 768px) {");
    expect(item234).toContain(".projection-card--pass .edge-indicator {");
  });

  it("a genuine PASS card still renders zero mint-signal classes today (backstop is defense-in-depth, not the only guard)", () => {
    const game: ProjectionGame = {
      id: "oak-tex-backstop",
      league: "MLB",
      status: "scheduled",
      statusLabel: "7:05 PM ET",
      away: { abbr: "OAK", name: "Athletics", logo: null, color: "#333333", score: null },
      home: { abbr: "TEX", name: "Rangers", logo: null, color: "#333333", score: null },
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
    const html = render(game);
    const marketHtml = renderMarket(game);
    expect(html).toContain("projection-card--pass");
    expect(marketHtml).not.toContain("market-table__model--signal");
    expect(marketHtml).not.toContain("market-table__result--edge");
    expect(html).not.toMatch(/class="edge-indicator summary__edge"/);
  });

  it("a LIVE card with zero edges never takes PASS (final-review I2 precedence ruling)", () => {
    // Reachable state: a mid-game model invalidation nulls every model price
    // (DimeModelFeed's mlbRowToCard) while the game is live. The precedence
    // ruling — annotated in ai-model-projections.md "PASS games" — is that
    // live-ness wins: the mint LIVE signal renders undimmed, and the PASS
    // zero-mint law simply never applies to a live card.
    const html = render({
      id: "lad-nyy-live-noedge",
      league: "MLB",
      status: "live",
      statusLabel: "LIVE · 5th",
      away: { abbr: "LAD", name: "Dodgers", logo: null, color: "#333333", score: 3 },
      home: { abbr: "NYY", name: "Yankees", logo: null, color: "#333333", score: 2 },
      matchupContext: "Yankee Stadium",
      venue: "Yankee Stadium",
      startTime: "7:05 PM ET",
      markets: [
        {
          key: "moneyline",
          label: "Moneyline",
          sides: [
            { marketKey: "moneyline", marketLabel: "Moneyline", sideLabel: "Dodgers ML", bookPrice: -110, bookOppPrice: -110, modelPrice: null },
            { marketKey: "moneyline", marketLabel: "Moneyline", sideLabel: "Yankees ML", bookPrice: -110, bookOppPrice: -110, modelPrice: null },
          ],
        },
      ],
    });
    expect(html).not.toContain("projection-card--pass");
    expect(html).toContain("projection-card__live-dot");
    expect(html).toContain("LIVE · 5th");
    // The ruling is recorded in the page law, so a future session can't
    // silently re-collide the two laws.
    expect(lawDoc).toContain("a LIVE card never takes the PASS treatment");
  });
});

describe("ProjectionCard — .summary__item--message hook (Round 4 Wave 3 fold-in, W1 review)", () => {
  it("is NOT dead: W2 gave it a real, consumed grid-column rule (resolves the W1-flagged hook)", () => {
    // The class renders in the PASS-message branch (ProjectionSummary.tsx)...
    const passHtml = render({
      id: "oak-tex-message-hook",
      league: "MLB",
      status: "scheduled",
      statusLabel: "7:05 PM ET",
      away: { abbr: "OAK", name: "Athletics", logo: null, color: "#333333", score: null },
      home: { abbr: "TEX", name: "Rangers", logo: null, color: "#333333", score: null },
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
    });
    expect(passHtml).toContain('class="summary__item summary__item--message"');
    // ...and a real CSS rule consumes it (not a no-op class with zero rules).
    expect(cardCss).toContain(".summary__item--message { grid-column: 1 / span 3; }");
  });
});
