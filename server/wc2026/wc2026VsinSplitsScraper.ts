/**
 * wc2026VsinSplitsScraper.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Scrapes VSIN DraftKings betting splits for World Cup 2026 fixtures.
 *
 * URL: https://data.vsin.com/betting-splits/?source=DK&sport=SOC&league=209533
 *
 * HTML structure (same 11-column sp-table as MLB/NBA):
 *   tr.sp-row → gamecode=SOCxxxxxxxx
 *   td[1]  → team name (plain text, no anchor slug)
 *   td[3]  → spread tickets %  (may be '-' for soccer)
 *   td[4]  → spread money %    (may be '-' for soccer)
 *   td[6]  → total tickets %
 *   td[7]  → total money %
 *   td[9]  → ML tickets %
 *   td[10] → ML money %
 *
 * Logging format:
 *   [WC2026Splits] [INPUT]  → URL, row count
 *   [WC2026Splits] [STEP]   → per-game processing
 *   [WC2026Splits] [STATE]  → per-team splits values
 *   [WC2026Splits] [OUTPUT] → rows written
 *   [WC2026Splits] [VERIFY] → PASS / FAIL + reason
 */

import * as cheerio from "cheerio";
import { getDb } from "../db";
import {
  wc2026BettingSplits,
  type InsertWc2026BettingSplit,
} from "../../drizzle/wc2026.schema";
import { resolveWcTeam } from "./resolveWcTeam";

const VSIN_URL =
  "https://data.vsin.com/betting-splits/?source=DK&sport=SOC&league=209533";

const VSIN_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
  Referer: "https://data.vsin.com/",
};

function parsePct(raw: string): number | null {
  const s = raw.trim().replace("%", "");
  if (s === "-" || s === "" || s === "N/A") return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n / 100;
}

export async function scrapeWc2026VsinSplits(): Promise<{
  rowsWritten: number;
  gamesProcessed: number;
  errors: string[];
}> {
  const snapshotTs = new Date();
  console.log(
    `[WC2026Splits] [INPUT] url=${VSIN_URL} ts=${snapshotTs.toISOString()}`
  );

  let html: string;
  try {
    const res = await fetch(VSIN_URL, { headers: VSIN_HEADERS });
    if (!res.ok) throw new Error(`VSIN HTTP ${res.status}: ${res.statusText}`);
    html = await res.text();
  } catch (err) {
    const msg = `[WC2026Splits] [VERIFY] FAIL — fetch error: ${String(err)}`;
    console.error(msg);
    return { rowsWritten: 0, gamesProcessed: 0, errors: [msg] };
  }

  const $ = cheerio.load(html);
  const rows = $("tr.sp-row");
  console.log(`[WC2026Splits] [STEP] Found ${rows.length} sp-row elements`);

  if (rows.length === 0) {
    console.log("[WC2026Splits] [OUTPUT] No rows found — no WC2026 games on VSIN today");
    return { rowsWritten: 0, gamesProcessed: 0, errors: [] };
  }

  const db = await getDb();
  const errors: string[] = [];
  const insertRows: InsertWc2026BettingSplit[] = [];
  let gamesProcessed = 0;

  // VSIN groups two rows per game (away team row, home team row)
  // We process them in pairs
  const rowEls = rows.toArray();

  for (let i = 0; i < rowEls.length; i += 2) {
    const awayRow = $(rowEls[i]);
    const homeRow = rowEls[i + 1] ? $(rowEls[i + 1]) : null;

    const awayName = awayRow.find("td").eq(1).text().trim();
    const homeName = homeRow?.find("td").eq(1).text().trim() ?? "";

    console.log(
      `[WC2026Splits] [STEP] Processing pair: away="${awayName}" home="${homeName}"`
    );

    const [resolvedAway, resolvedHome] = await Promise.all([
      resolveWcTeam(awayName),
      resolveWcTeam(homeName),
    ]);

    if (!resolvedAway) {
      const msg = `[WC2026Splits] [VERIFY] FAIL — Unresolved away team: "${awayName}"`;
      console.error(msg);
      errors.push(msg);
      continue;
    }
    if (!resolvedHome) {
      const msg = `[WC2026Splits] [VERIFY] FAIL — Unresolved home team: "${homeName}"`;
      console.error(msg);
      errors.push(msg);
      continue;
    }

    // Extract splits from away row (VSIN shows both teams' splits in the same row pair)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const extractSplits = (row: any) => {
      const tds = row.find("td");
      return {
        spreadTickets: parsePct(tds.eq(3).text()),
        spreadMoney: parsePct(tds.eq(4).text()),
        totalTickets: parsePct(tds.eq(6).text()),
        totalMoney: parsePct(tds.eq(7).text()),
        mlTickets: parsePct(tds.eq(9).text()),
        mlMoney: parsePct(tds.eq(10).text()),
      };
    };

    const awaySplits = extractSplits(awayRow);
    const homeSplits = homeRow ? extractSplits(homeRow) : null;

    console.log(
      `[WC2026Splits] [STATE] Away (${resolvedAway}): ML=${awaySplits.mlTickets}t/${awaySplits.mlMoney}m TOTAL=${awaySplits.totalTickets}t/${awaySplits.totalMoney}m`
    );
    if (homeSplits) {
      console.log(
        `[WC2026Splits] [STATE] Home (${resolvedHome}): ML=${homeSplits.mlTickets}t/${homeSplits.mlMoney}m TOTAL=${homeSplits.totalTickets}t/${homeSplits.totalMoney}m`
      );
    }

    // We need fixtureId — look it up from the gamecode or by team pair
    // VSIN gamecode is on the row's data-gamecode attribute
    const gamecode = awayRow.attr("data-gamecode") ?? awayRow.attr("gamecode") ?? "";
    console.log(`[WC2026Splits] [STATE] gamecode="${gamecode}"`);

    // Fetch fixture by team pair
    const { wc2026Fixtures } = await import("../../drizzle/wc2026.schema");
    const { eq, and } = await import("drizzle-orm");
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
      const msg = `[WC2026Splits] [VERIFY] FAIL — No fixture: away=${resolvedAway} home=${resolvedHome}`;
      console.error(msg);
      errors.push(msg);
      continue;
    }

    // Build insert rows for away team
    if (awaySplits.mlTickets !== null || awaySplits.mlMoney !== null) {
      insertRows.push({
        fixtureId,
        snapshotTs,
        teamId: resolvedAway,
        market: "ML",
        ticketsPct: awaySplits.mlTickets ?? undefined,
        moneyPct: awaySplits.mlMoney ?? undefined,
      });
    }
    if (awaySplits.totalTickets !== null || awaySplits.totalMoney !== null) {
      insertRows.push({
        fixtureId,
        snapshotTs,
        teamId: resolvedAway,
        market: "TOTAL",
        ticketsPct: awaySplits.totalTickets ?? undefined,
        moneyPct: awaySplits.totalMoney ?? undefined,
      });
    }

    // Build insert rows for home team
    if (homeSplits) {
      if (homeSplits.mlTickets !== null || homeSplits.mlMoney !== null) {
        insertRows.push({
          fixtureId,
          snapshotTs,
          teamId: resolvedHome,
          market: "ML",
          ticketsPct: homeSplits.mlTickets ?? undefined,
          moneyPct: homeSplits.mlMoney ?? undefined,
        });
      }
      if (homeSplits.totalTickets !== null || homeSplits.totalMoney !== null) {
        insertRows.push({
          fixtureId,
          snapshotTs,
          teamId: resolvedHome,
          market: "TOTAL",
          ticketsPct: homeSplits.totalTickets ?? undefined,
          moneyPct: homeSplits.totalMoney ?? undefined,
        });
      }
    }

    gamesProcessed++;
  }

  let rowsWritten = 0;
  if (insertRows.length > 0) {
    try {
      await db.insert(wc2026BettingSplits).values(insertRows);
      rowsWritten = insertRows.length;
      console.log(`[WC2026Splits] [OUTPUT] Wrote ${rowsWritten} split rows for ${gamesProcessed} games`);
    } catch (err) {
      const msg = `[WC2026Splits] [VERIFY] FAIL — DB insert: ${String(err)}`;
      console.error(msg);
      errors.push(msg);
    }
  }

  console.log(
    `[WC2026Splits] [VERIFY] ${errors.length === 0 ? "PASS" : "FAIL"} — rowsWritten=${rowsWritten} gamesProcessed=${gamesProcessed} errors=${errors.length}`
  );
  return { rowsWritten, gamesProcessed, errors };
}
