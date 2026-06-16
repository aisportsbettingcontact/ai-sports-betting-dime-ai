/**
 * wc2026DkSplitsScraper.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Scrapes DraftKings Network betting splits for World Cup 2026 fixtures.
 *
 * Source: https://dknetwork.draftkings.com/draftkings-sportsbook-betting-splits/
 *         ?tb_eg=209533&tb_edate=n30days&tb_emt=0
 *
 * Data structure (parsed from rendered HTML):
 *   .tb-se                 → one game container
 *     .tb-se-title         → game title + date/time (EST)
 *       h5 > a             → "TeamA vs TeamB"
 *       span               → "6/16, 03:00PM"
 *     .tb-market-wrap
 *       [market section]   → one per market type (Moneyline, Spread, Total)
 *         .tb-se-head      → ["Moneyline"|"Spread"|"Total", "Odds", "% Handle", "% Bets"]
 *         .tb-sm
 *           .tb-sodd       → one row per team/line
 *             .tb-slipline → team name or "Team -1.5" etc.
 *             div[1]       → odds (anchor text)
 *             div[2]       → % Handle (text + progress bar)
 *             div[3]       → % Bets (text + progress bar)
 *
 * We extract:
 *   - ML: away team handle%, bets% + home team handle%, bets%
 *   - TOTAL: Over handle%, bets% + Under handle%, bets%
 *   - SPREAD: skipped (soccer spread has many lines, not a clean 2-row split)
 *
 * Times on DK Network are in EST. We parse them and convert to UTC for DB storage.
 *
 * Logging format:
 *   [DkSplits] [INPUT]  → raw data
 *   [DkSplits] [STEP]   → processing step
 *   [DkSplits] [STATE]  → intermediate values
 *   [DkSplits] [OUTPUT] → result
 *   [DkSplits] [VERIFY] → PASS / FAIL + reason
 */

import * as cheerio from "cheerio";
import { getDb } from "../db";
import { wc2026BettingSplits, wc2026Fixtures } from "../../drizzle/wc2026.schema";
import { resolveWcTeam } from "./resolveWcTeam";
import { and, eq, inArray, desc } from "drizzle-orm";

const DK_SPLITS_URL =
  "https://dknetwork.draftkings.com/draftkings-sportsbook-betting-splits/?tb_eg=209533&tb_edate=n30days&tb_emt=0";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TeamSplit {
  teamId: string;
  market: "ML" | "TOTAL" | "SPREAD";
  ticketsPct: number | null; // % Bets
  moneyPct: number | null;   // % Handle
}

interface ParsedGame {
  rawTitle: string;         // "France vs Senegal"
  rawDate: string;          // "6/16, 03:00PM"
  awayName: string;
  homeName: string;
  splits: TeamSplit[];
}

export interface DkSplitsResult {
  rowsWritten: number;
  gamesProcessed: number;
  errors: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse a percentage string like "92%" → 92.0
 * Returns null if unparseable.
 */
function parsePct(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.]/g, "").trim();
  if (!cleaned) return null;
  const val = parseFloat(cleaned);
  return isNaN(val) ? null : val;
}

/**
 * Parse DK Network date string "6/16, 03:00PM" (EST) → UTC Date.
 * Year is inferred as current year (2026 for World Cup).
 * Returns null if unparseable.
 */
function parseDkDateToUtc(raw: string): Date | null {
  try {
    // Expected format: "M/D, H:MMam/pm" e.g. "6/16, 03:00PM"
    const match = raw.match(/(\d+)\/(\d+),\s*(\d+):(\d+)(AM|PM)/i);
    if (!match) {
      console.warn(`[DkSplits] [STEP] Could not parse date: "${raw}"`);
      return null;
    }
    const [, month, day, hourStr, minStr, ampm] = match;
    let hour = parseInt(hourStr, 10);
    const min = parseInt(minStr, 10);
    if (ampm.toUpperCase() === "PM" && hour !== 12) hour += 12;
    if (ampm.toUpperCase() === "AM" && hour === 12) hour = 0;
    // EST = UTC-5 (no DST adjustment needed for WC 2026 June/July)
    const estOffsetHours = 5;
    const utcHour = hour + estOffsetHours;
    // Build UTC date — year 2026 for World Cup
    const utcDate = new Date(
      Date.UTC(2026, parseInt(month, 10) - 1, parseInt(day, 10), utcHour % 24, min, 0)
    );
    // Handle day rollover
    if (utcHour >= 24) {
      utcDate.setUTCDate(utcDate.getUTCDate() + 1);
    }
    return utcDate;
  } catch (e) {
    console.warn(`[DkSplits] [STEP] Date parse error for "${raw}": ${e}`);
    return null;
  }
}

// ─── HTML Parser ──────────────────────────────────────────────────────────────

/**
 * Parse the DK Network HTML into structured game data.
 * Returns an array of ParsedGame objects.
 */
function parseDkHtml(html: string): ParsedGame[] {
  const $ = cheerio.load(html);
  const games: ParsedGame[] = [];

  console.log(`[DkSplits] [STEP] Loaded HTML, parsing .tb-se containers`);

  $(".tb-se").each((i, el) => {
    const container = $(el);

    // ── Title ──────────────────────────────────────────────────────────────
    const titleDiv = container.find(".tb-se-title");
    const titleLink = titleDiv.find("h5 a");
    const rawTitle = titleLink
      .clone()
      .find(".screen-reader-text")
      .remove()
      .end()
      .text()
      .trim();
    const rawDate = titleDiv.find("span").first().text().trim();

    if (!rawTitle.includes(" vs ")) {
      console.warn(`[DkSplits] [STEP] Skipping non-matchup title: "${rawTitle}"`);
      return;
    }

    const [awayName, homeName] = rawTitle.split(" vs ").map((s) => s.trim());

    console.log(
      `[DkSplits] [STATE] Game ${i + 1}: "${rawTitle}" date="${rawDate}" away="${awayName}" home="${homeName}"`
    );

    const splits: TeamSplit[] = [];

    // ── Markets ────────────────────────────────────────────────────────────
    // Each market section is a direct child div of .tb-market-wrap
    const marketWrap = container.find(".tb-market-wrap");
    marketWrap.children("div").each((_, marketEl) => {
      const market$ = $(marketEl);
      const headDivs = market$.find(".tb-se-head > div");
      const marketLabel = headDivs.first().text().trim().toLowerCase();

      // We only process Moneyline and Total
      if (marketLabel !== "moneyline" && marketLabel !== "total") {
        console.log(`[DkSplits] [STEP] Skipping market: "${marketLabel}"`);
        return;
      }

      const marketType: "ML" | "TOTAL" =
        marketLabel === "moneyline" ? "ML" : "TOTAL";

      console.log(`[DkSplits] [STEP] Processing market: ${marketType}`);

      // For Moneyline: first .tb-sodd = away team, second = home team
      // For Total: first .tb-sodd = Over, second = Under
      const rows = market$.find(".tb-sodd");

      if (marketType === "ML") {
        // Away team (first row)
        const awayRow = rows.eq(0);
        const awayHandleRaw = awayRow.find("div").eq(2).text().trim();
        const awayBetsRaw = awayRow.find("div").eq(3).text().trim();
        const awayHandle = parsePct(awayHandleRaw);
        const awayBets = parsePct(awayBetsRaw);

        console.log(
          `[DkSplits] [STATE] ML Away "${awayName}": handle="${awayHandleRaw}"(${awayHandle}) bets="${awayBetsRaw}"(${awayBets})`
        );

        // Home team (second row)
        const homeRow = rows.eq(1);
        const homeHandleRaw = homeRow.find("div").eq(2).text().trim();
        const homeBetsRaw = homeRow.find("div").eq(3).text().trim();
        const homeHandle = parsePct(homeHandleRaw);
        const homeBets = parsePct(homeBetsRaw);

        console.log(
          `[DkSplits] [STATE] ML Home "${homeName}": handle="${homeHandleRaw}"(${homeHandle}) bets="${homeBetsRaw}"(${homeBets})`
        );

        // We store teamId after resolution — use placeholder for now
        splits.push({
          teamId: `__away__:${awayName}`,
          market: "ML",
          ticketsPct: awayBets,
          moneyPct: awayHandle,
        });
        splits.push({
          teamId: `__home__:${homeName}`,
          market: "ML",
          ticketsPct: homeBets,
          moneyPct: homeHandle,
        });
      } else if (marketType === "TOTAL") {
        // Over (first row) — stored under away team's teamId with market=TOTAL
        const overRow = rows.eq(0);
        const overHandleRaw = overRow.find("div").eq(2).text().trim();
        const overBetsRaw = overRow.find("div").eq(3).text().trim();
        const overHandle = parsePct(overHandleRaw);
        const overBets = parsePct(overBetsRaw);

        console.log(
          `[DkSplits] [STATE] TOTAL Over: handle="${overHandleRaw}"(${overHandle}) bets="${overBetsRaw}"(${overBets})`
        );

        // Under (second row) — stored under home team's teamId with market=TOTAL
        const underRow = rows.eq(1);
        const underHandleRaw = underRow.find("div").eq(2).text().trim();
        const underBetsRaw = underRow.find("div").eq(3).text().trim();
        const underHandle = parsePct(underHandleRaw);
        const underBets = parsePct(underBetsRaw);

        console.log(
          `[DkSplits] [STATE] TOTAL Under: handle="${underHandleRaw}"(${underHandle}) bets="${underBetsRaw}"(${underBets})`
        );

        // Over stored under away team, Under stored under home team
        // (consistent with how WcSplitsFeed reads them)
        splits.push({
          teamId: `__away__:${awayName}`,
          market: "TOTAL",
          ticketsPct: overBets,
          moneyPct: overHandle,
        });
        splits.push({
          teamId: `__home__:${homeName}`,
          market: "TOTAL",
          ticketsPct: underBets,
          moneyPct: underHandle,
        });
      }
    });

    games.push({ rawTitle, rawDate, awayName, homeName, splits });
  });

  console.log(`[DkSplits] [OUTPUT] Parsed ${games.length} games from HTML`);
  return games;
}

// ─── Main Scraper ─────────────────────────────────────────────────────────────

export async function scrapeWc2026DkSplits(): Promise<DkSplitsResult> {
  const errors: string[] = [];
  let gamesProcessed = 0;
  let rowsWritten = 0;
  const snapshotTs = new Date();

  console.log(
    `[DkSplits] [INPUT] Starting DK Network WC splits scrape at ${snapshotTs.toISOString()}`
  );
  console.log(`[DkSplits] [INPUT] URL: ${DK_SPLITS_URL}`);

  // ── Fetch HTML ─────────────────────────────────────────────────────────────
  let html: string;
  try {
    const resp = await fetch(DK_SPLITS_URL, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: "https://dknetwork.draftkings.com/",
      },
    });
    if (!resp.ok) {
      const msg = `[DkSplits] [VERIFY] FAIL — HTTP ${resp.status} fetching DK Network`;
      console.error(msg);
      errors.push(msg);
      return { rowsWritten: 0, gamesProcessed: 0, errors };
    }
    html = await resp.text();
    console.log(
      `[DkSplits] [STEP] Fetched HTML: ${html.length} bytes, status=${resp.status}`
    );
  } catch (e) {
    const msg = `[DkSplits] [VERIFY] FAIL — Fetch error: ${String(e)}`;
    console.error(msg);
    errors.push(msg);
    return { rowsWritten: 0, gamesProcessed: 0, errors };
  }

  // ── Parse HTML ─────────────────────────────────────────────────────────────
  const parsedGames = parseDkHtml(html);
  if (parsedGames.length === 0) {
    const msg = `[DkSplits] [VERIFY] FAIL — No games parsed from HTML`;
    console.error(msg);
    errors.push(msg);
    return { rowsWritten: 0, gamesProcessed: 0, errors };
  }

  const db = await getDb();

  // ── Process each game ──────────────────────────────────────────────────────
  for (const game of parsedGames) {
    console.log(`\n[DkSplits] [STEP] Resolving teams for "${game.rawTitle}"`);

    // Resolve team names → teamIds
    const [resolvedAway, resolvedHome] = await Promise.all([
      resolveWcTeam(game.awayName),
      resolveWcTeam(game.homeName),
    ]);

    if (!resolvedAway) {
      const msg = `[DkSplits] [VERIFY] FAIL — Unresolved away team: "${game.awayName}"`;
      console.error(msg);
      errors.push(msg);
      continue;
    }
    if (!resolvedHome) {
      const msg = `[DkSplits] [VERIFY] FAIL — Unresolved home team: "${game.homeName}"`;
      console.error(msg);
      errors.push(msg);
      continue;
    }

    console.log(
      `[DkSplits] [STATE] Resolved: away="${game.awayName}"→${resolvedAway} home="${game.homeName}"→${resolvedHome}`
    );

    // Find the fixture by team pair
    const fixtures = await db
      .select({ fixtureId: wc2026Fixtures.fixtureId })
      .from(wc2026Fixtures)
      .where(
        and(
          eq(wc2026Fixtures.awayTeamId, resolvedAway),
          eq(wc2026Fixtures.homeTeamId, resolvedHome)
        )
      )
      .limit(1);

    const fixtureId = fixtures[0]?.fixtureId;
    if (!fixtureId) {
      // Also try reversed (DK Network may swap home/away for some fixtures)
      const fixturesReversed = await db
        .select({ fixtureId: wc2026Fixtures.fixtureId })
        .from(wc2026Fixtures)
        .where(
          and(
            eq(wc2026Fixtures.awayTeamId, resolvedHome),
            eq(wc2026Fixtures.homeTeamId, resolvedAway)
          )
        )
        .limit(1);

      if (!fixturesReversed[0]?.fixtureId) {
        const msg = `[DkSplits] [VERIFY] FAIL — No fixture: away=${resolvedAway} home=${resolvedHome}`;
        console.error(msg);
        errors.push(msg);
        continue;
      }

      // Use reversed fixture — swap away/home teamIds in splits
      const reversedFixtureId = fixturesReversed[0].fixtureId;
      console.log(
        `[DkSplits] [STATE] Using reversed fixture ${reversedFixtureId} (DK swapped home/away)`
      );

      const insertRows = game.splits.map((s) => ({
        fixtureId: reversedFixtureId,
        snapshotTs,
        teamId: s.teamId.startsWith("__away__:")
          ? resolvedHome  // DK's "away" is actually home in our DB
          : resolvedAway, // DK's "home" is actually away in our DB
        market: s.market,
        ticketsPct: s.ticketsPct ?? undefined,
        moneyPct: s.moneyPct ?? undefined,
      }));

      if (insertRows.length > 0) {
        await db.insert(wc2026BettingSplits).values(insertRows);
        rowsWritten += insertRows.length;
        console.log(
          `[DkSplits] [OUTPUT] Wrote ${insertRows.length} rows for reversed fixture ${reversedFixtureId}`
        );
      }
      gamesProcessed++;
      continue;
    }

    console.log(`[DkSplits] [STATE] Fixture: ${fixtureId}`);

    // Build insert rows — replace placeholder teamId with resolved teamId
    const insertRows = game.splits.map((s) => ({
      fixtureId,
      snapshotTs,
      teamId: s.teamId.startsWith("__away__:") ? resolvedAway : resolvedHome,
      market: s.market,
      ticketsPct: s.ticketsPct ?? undefined,
      moneyPct: s.moneyPct ?? undefined,
    }));

    if (insertRows.length > 0) {
      try {
        await db.insert(wc2026BettingSplits).values(insertRows);
        rowsWritten += insertRows.length;
        console.log(
          `[DkSplits] [OUTPUT] Wrote ${insertRows.length} rows for fixture ${fixtureId}`
        );
      } catch (e) {
        const msg = `[DkSplits] [VERIFY] FAIL — DB insert for ${fixtureId}: ${String(e)}`;
        console.error(msg);
        errors.push(msg);
      }
    }

    gamesProcessed++;
  }

  console.log(
    `\n[DkSplits] [VERIFY] ${errors.length === 0 ? "PASS" : "FAIL"} — rowsWritten=${rowsWritten} gamesProcessed=${gamesProcessed} errors=${errors.length}`
  );

  return { rowsWritten, gamesProcessed, errors };
}
