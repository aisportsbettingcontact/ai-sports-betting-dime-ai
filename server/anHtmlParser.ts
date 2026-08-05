/**
 * Action Network Best-Odds HTML Parser — All Markets Mode
 *
 * Parses the HTML from the Action Network "All Markets" best-odds table
 * (https://www.actionnetwork.com/ncaab/odds?oddsType=combined)
 * (https://www.actionnetwork.com/nba/odds?oddsType=combined)
 * (https://www.actionnetwork.com/nhl/odds?oddsType=combined)
 *
 * In "All Markets" view, the table has 3 <tr> rows per game:
 *   Row 1 (SPREAD)    — has the game link + team names + rotation numbers
 *   Row 2 (TOTAL)     — open cell starts with "o" or "u"
 *   Row 3 (ML)        — open cell has 3-digit moneyline values (e.g. "+285")
 *   Row N (SEPARATOR) — empty / 1-cell row between games
 *
 * Each data row has 12 cells:
 *   [0]    = Game info (team names, rotation numbers, game link)
 *   [1]    = Open line (best-odds__open-container)
 *   [2..11]= Book columns (best-odds__odds-container)
 *
 * Within each book cell there are 2 wrapper divs (away / home).
 * The DK NJ logo appears on the wrapper that has the BEST odds for that side.
 * We dynamically detect the DK column by scanning for "DK" in img alt text.
 *
 * Extracted fields per game:
 *   - Open spread (away + home) with juice
 *   - Open total (over + under) with juice
 *   - Open moneyline (away + home)
 *   - DK NJ spread (away + home) with juice
 *   - DK NJ total (over + under) with juice
 *   - DK NJ moneyline (away + home)
 */

import * as cheerio from "cheerio";

// ─── Public types ──────────────────────────────────────────────────────────────

export interface AnOddsEntry {
  /** e.g. "+6.5", "-8.5", "o145.5", "u145.5", "+285", "-365" */
  line: string;
  /** American odds format, e.g. "-105", "+100", "-110" */
  juice: string;
}

export interface AnParsedGame {
  /** AN internal game ID extracted from the game URL, e.g. "287105" */
  anGameId: string;
  /** Full game URL path, e.g. "/ncaab-game/saint-josephs-vcu-score-odds-march-14-2026/287105" */
  gameUrl: string;

  awayName: string;
  awayAbbr: string;
  awayRot: string | null;
  awayLogo: string;

  homeName: string;
  homeAbbr: string;
  homeRot: string | null;
  homeLogo: string;

  // ── Opening lines (from Open column) ──
  openAwaySpread: AnOddsEntry | null;
  openHomeSpread: AnOddsEntry | null;
  openOver: AnOddsEntry | null;
  openUnder: AnOddsEntry | null;
  openAwayML: AnOddsEntry | null;
  openHomeML: AnOddsEntry | null;

  // ── DK NJ current lines ──
  dkAwaySpread: AnOddsEntry | null;
  dkHomeSpread: AnOddsEntry | null;
  dkOver: AnOddsEntry | null;
  dkUnder: AnOddsEntry | null;
  dkAwayML: AnOddsEntry | null;
  dkHomeML: AnOddsEntry | null;
}

export interface AnParseResult {
  games: AnParsedGame[];
  dkColumnIndex: number;
  warnings: string[];
}

// ─── Internal helpers ──────────────────────────────────────────────────────────

type CheerioAPI = ReturnType<typeof cheerio.load>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type El = any;

/**
 * Find the DK NJ column index by scanning the header row (<th> elements).
 * The header row contains book logo images with alt text like "DK NJ logo".
 * Falls back to scanning data rows if no header is found.
 * Returns the column index of the DK NJ book column.
 */
function findDkColumnIndex(api: CheerioAPI, rows: El[]): number {
  // Strategy 1: Look for a header row with <th> elements containing book logos
  const headerRow = rows.find((r: El) => api(r).find("th").length > 0);
  if (headerRow) {
    const headers = api(headerRow).find("th").toArray();
    for (let i = 0; i < headers.length; i++) {
      const altText = api(headers[i]).find("img").attr("alt") || "";
      if (/DK NJ/i.test(altText) || /DraftKings/i.test(altText)) {
        return i;
      }
    }
  }

  // Strategy 2: Look for a row with <td> header-like cells (some AN pages use <td> for headers)
  for (const row of rows) {
    const cells = api(row).find("> td").toArray();
    for (let i = 0; i < cells.length; i++) {
      const altText = api(cells[i]).find("img").attr("alt") || "";
      if (/DK NJ/i.test(altText) || /DraftKings/i.test(altText)) {
        return i;
      }
    }
  }

  // Strategy 3: Fallback — scan data rows for DK logo in book cells (old behavior)
  // The DK logo appears in data cells only when DK has the best odds for that side.
  // Count occurrences per column — the true DK column will have the most.
  const counts: Record<number, number> = {};
  for (const row of rows) {
    const cells = api(row).find("> td").toArray();
    cells.forEach((cell: El, ci: number) => {
      const hasDK = api(cell).find('img[alt*="DK"]').length > 0;
      if (hasDK) counts[ci] = (counts[ci] || 0) + 1;
    });
  }
  const entries = Object.entries(counts).sort(
    (a, b) => Number(b[1]) - Number(a[1])
  );
  if (entries.length) {
    console.warn(
      `[AnHtmlParser] No header row found — using data-row DK logo scan, best column: ${entries[0][0]}`
    );
    return Number(entries[0][0]);
  }

  console.warn(
    "[AnHtmlParser] Could not find DK NJ column — using fallback index 8"
  );
  return 8; // updated fallback based on known NCAAB structure
}

type RowType = "SPREAD" | "TOTAL" | "ML" | "SEPARATOR";

/** Supported sports for AN HTML parsing */
export type AnSport = "ncaab" | "nba" | "nhl";

/** Game link patterns per sport */
const SPORT_LINK_PATTERNS: Record<AnSport, string> = {
  ncaab: "ncaab-game",
  nba: "nba-game",
  nhl: "nhl-game",
};

// Minimum cell count per sport:
// NCAAB: 12 (8 books + Open + Game info + Best Odds + 1 extra)
// NBA/NHL: 11 (7 books + Open + Game info + Best Odds + 1 extra)
const MIN_CELLS_BY_SPORT: Record<AnSport, number> = {
  ncaab: 10, // use 10 as floor to be safe (actual is 12)
  nba: 9, // use 9 as floor to be safe (actual is 11)
  nhl: 9, // use 9 as floor to be safe (actual is 11)
};

function classifyRow(api: CheerioAPI, row: El, sport: AnSport): RowType {
  const cells = api(row).find("> td").toArray();
  const minCells = MIN_CELLS_BY_SPORT[sport];
  if (cells.length < minCells) return "SEPARATOR";

  const linkPattern = SPORT_LINK_PATTERNS[sport];
  const hasLink = api(row).find(`a[href*="${linkPattern}"]`).length > 0;
  if (hasLink) return "SPREAD";

  const openCells = api(row).find(".best-odds__open-cell").toArray();
  const openTexts = openCells.map((c: El) =>
    api(c).children("div").first().text().trim()
  );

  if (openTexts.some((t: string) => /^[ou]/i.test(t))) return "TOTAL";
  if (openTexts.some((t: string) => /^[+-]\d{3}/.test(t))) return "ML";
  return "SEPARATOR";
}

/**
 * Parse the Open column cell (column index 1).
 * Contains two .best-odds__open-cell elements (away/home or over/under).
 */
function parseOpenCell(
  api: CheerioAPI,
  cell: El
): { away: AnOddsEntry | null; home: AnOddsEntry | null } {
  const openCells = api(cell).find(".best-odds__open-cell").toArray();
  if (openCells.length < 2) return { away: null, home: null };

  const parseOne = (el: El): AnOddsEntry | null => {
    const $el = api(el);
    const allDivs = $el.children("div").toArray();
    const secondary = $el.find(".best-odds__open-cell-secondary");
    const lineDiv = allDivs.find(
      (d: El) => !api(d).hasClass("best-odds__open-cell-secondary")
    );
    const line = lineDiv ? api(lineDiv).text().trim() : "";
    const juice = secondary.find("div").first().text().trim();
    if (!line) return null;
    return { line, juice: juice || "-110" };
  };

  return { away: parseOne(openCells[0]), home: parseOne(openCells[1]) };
}

/**
 * Parse a book odds cell (e.g. DK column).
 * Contains two wrapper divs (away / home).
 * Each wrapper has [data-testid="book-cell__odds"] with spans for line + juice.
 * N/A cells have a span with class css-1db6njd.
 * Best-odds cells have an extra SVG bookmark icon span (filtered out).
 * Book logo spans (picture elements) are also filtered out.
 */
function parseBookCell(
  api: CheerioAPI,
  cell: El
): { away: AnOddsEntry | null; home: AnOddsEntry | null } {
  const wrappers = api(cell).find(".best-odds__odds-container > div").toArray();
  if (wrappers.length < 2) return { away: null, home: null };

  const parseWrapper = (wrapper: El): AnOddsEntry | null => {
    const oddsDiv = api(wrapper).find('[data-testid="book-cell__odds"]');
    // N/A check — disabled cells have .css-1db6njd class on the span
    const isNA = oddsDiv.find(".css-1db6njd").length > 0;
    if (isNA) return null;

    // Filter spans: exclude those containing SVG (bookmark icon) or picture (book logo)
    const spans = oddsDiv
      .find("span")
      .toArray()
      .filter(
        (s: El) =>
          api(s).find("svg").length === 0 && api(s).find("picture").length === 0
      );

    const texts = spans
      .map((s: El) => api(s).text().trim())
      .filter((t: string) => t && t !== "N/A");

    if (!texts.length) return null;
    return { line: texts[0], juice: texts[1] || "-110" };
  };

  return { away: parseWrapper(wrappers[0]), home: parseWrapper(wrappers[1]) };
}

// ─── Main parser ───────────────────────────────────────────────────────────────

/**
 * Parse Action Network "All Markets" HTML tbody fragment.
 *
 * Pass the raw HTML from the AN best-odds page (the <tbody> content or full page).
 * The parser wraps it in a <table> to ensure cheerio handles <tr>/<td> correctly.
 *
 * @param html   Raw HTML string from the AN best-odds page
 * @param sport  Sport identifier: "ncaab" | "nba" | "nhl" (default: "ncaab")
 * @returns      Parsed game odds with open lines and DK NJ lines for all markets
 */
export function parseAnAllMarketsHtml(
  html: string,
  sport: AnSport = "ncaab"
): AnParseResult {
  const warnings: string[] = [];

  // Wrap in <table> so cheerio correctly parses <tr>/<td> elements
  const $ = cheerio.load("<table>" + html + "</table>");
  const rows = $("tr").toArray();

  if (!rows.length) {
    warnings.push(
      "No <tr> rows found — ensure you paste the full <tbody> HTML from the AN best-odds page"
    );
    return { games: [], dkColumnIndex: -1, warnings };
  }

  const dkColumnIndex = findDkColumnIndex($, rows);
  if (dkColumnIndex < 0) {
    warnings.push(
      "Could not find DK NJ column — no 'DK' logo found in any cell. Using fallback index 9."
    );
  }

  const games: AnParsedGame[] = [];
  let currentGame: AnParsedGame | null = null;

  for (const row of rows) {
    const type = classifyRow($, row, sport);
    const cells = $(row).find("> td").toArray();

    if (type === "SPREAD") {
      // ── Extract game metadata ──
      const linkPattern = SPORT_LINK_PATTERNS[sport];
      const link = $(row).find(`a[href*="${linkPattern}"]`).attr("href") || "";
      const idMatch = link.match(/\/(\d+)$/);
      if (!idMatch) {
        warnings.push(`Could not extract AN game ID from link: ${link}`);
        currentGame = null;
        continue;
      }
      const anGameId = idMatch[1];

      const teamDivs = $(row).find(".game-info__teams").toArray();
      const awayName = teamDivs[0]
        ? $(teamDivs[0]).find(".game-info__team--desktop").first().text().trim()
        : "Unknown";
      const awayAbbr = teamDivs[0]
        ? $(teamDivs[0]).find(".game-info__team--mobile").first().text().trim()
        : "";
      const homeName = teamDivs[1]
        ? $(teamDivs[1]).find(".game-info__team--desktop").first().text().trim()
        : "Unknown";
      const homeAbbr = teamDivs[1]
        ? $(teamDivs[1]).find(".game-info__team--mobile").first().text().trim()
        : "";
      const awayLogo = teamDivs[0]
        ? $(teamDivs[0]).find("img.game-info__team-icon").first().attr("src") ||
          ""
        : "";
      const homeLogo = teamDivs[1]
        ? $(teamDivs[1]).find("img.game-info__team-icon").first().attr("src") ||
          ""
        : "";

      const rotDivs = $(row).find(".game-info__rot-number div").toArray();
      const awayRot = rotDivs[0] ? $(rotDivs[0]).text().trim() || null : null;
      const homeRot = rotDivs[1] ? $(rotDivs[1]).text().trim() || null : null;

      // ── Parse spread row odds ──
      const openSpread = parseOpenCell($, cells[1]);
      const dkSpread =
        dkColumnIndex >= 0
          ? parseBookCell($, cells[dkColumnIndex])
          : { away: null, home: null };

      currentGame = {
        anGameId,
        gameUrl: link,
        awayName,
        awayAbbr,
        awayRot,
        awayLogo,
        homeName,
        homeAbbr,
        homeRot,
        homeLogo,
        openAwaySpread: openSpread.away,
        openHomeSpread: openSpread.home,
        openOver: null,
        openUnder: null,
        openAwayML: null,
        openHomeML: null,
        dkAwaySpread: dkSpread.away,
        dkHomeSpread: dkSpread.home,
        dkOver: null,
        dkUnder: null,
        dkAwayML: null,
        dkHomeML: null,
      };
      games.push(currentGame);
    } else if (type === "TOTAL" && currentGame) {
      // ── Parse total row: "away" slot = over, "home" slot = under ──
      const openTotal = parseOpenCell($, cells[1]);
      const dkTotal =
        dkColumnIndex >= 0
          ? parseBookCell($, cells[dkColumnIndex])
          : { away: null, home: null };
      currentGame.openOver = openTotal.away;
      currentGame.openUnder = openTotal.home;
      currentGame.dkOver = dkTotal.away;
      currentGame.dkUnder = dkTotal.home;
    } else if (type === "ML" && currentGame) {
      // ── Parse moneyline row ──
      const openML = parseOpenCell($, cells[1]);
      const dkML =
        dkColumnIndex >= 0
          ? parseBookCell($, cells[dkColumnIndex])
          : { away: null, home: null };
      currentGame.openAwayML = openML.away;
      currentGame.openHomeML = openML.home;
      currentGame.dkAwayML = dkML.away;
      currentGame.dkHomeML = dkML.home;
    }
    // SEPARATOR rows: reset currentGame after a complete group (spread + total + ML)
    else if (
      type === "SEPARATOR" &&
      currentGame &&
      currentGame.openAwayML !== null
    ) {
      currentGame = null;
    }
  }

  console.log(
    `[AnHtmlParser] Parsed ${games.length} games | DK column: ${dkColumnIndex} | warnings: ${warnings.length}`
  );

  return { games, dkColumnIndex, warnings };
}
