/**
 * wc2026RotowireLineupsScraper.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Scrapes Rotowire World Cup 2026 predicted/confirmed lineups.
 *
 * URL: https://www.rotowire.com/soccer/lineups.php?league=WOC
 *
 * HTML structure (per div.lineup.is-soccer card):
 *   div.lineup__time                    → game date/time string
 *   div.lineup__team.is-home > div.lineup__abbr  → home team 3-letter abbr
 *   div.lineup__team.is-visit > div.lineup__abbr → away team 3-letter abbr
 *   div.lineup__main (2 per card: home + visit)
 *     div.lineup__status                → "Predicted Lineup" | "Confirmed Lineup"
 *     ul.lineup__list
 *       li.lineup__player (starters, before li.lineup__title.is-middle)
 *         div.lineup__pos               → position (GK/DC/MC/FW etc.)
 *         a[title]                      → player full name
 *         span.lineup__inj (optional)   → QUES/OUT/DTD
 *
 * Logging format:
 *   [WC2026Lineups] [INPUT]  → URL, card count
 *   [WC2026Lineups] [STEP]   → per-game processing
 *   [WC2026Lineups] [STATE]  → per-team player extraction
 *   [WC2026Lineups] [OUTPUT] → rows written
 *   [WC2026Lineups] [VERIFY] → PASS / FAIL + reason
 */

import * as cheerio from "cheerio";
import { getDb } from "../db";
import {
  wc2026Lineups,
  wc2026Matches,
  type InsertWc2026Lineup,
} from "../../drizzle/wc2026.schema";
import { resolveWcTeam } from "./resolveWcTeam";
import { eq, and } from "drizzle-orm";

const RW_URL = "https://www.rotowire.com/soccer/lineups.php?league=WOC";

const RW_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
  Referer: "https://www.rotowire.com/",
};

export async function scrapeWc2026Lineups(): Promise<{
  rowsWritten: number;
  gamesProcessed: number;
  errors: string[];
}> {
  const scrapedAt = new Date();
  console.log(`[WC2026Lineups] [INPUT] url=${RW_URL} ts=${scrapedAt.toISOString()}`);

  let html: string;
  try {
    const res = await fetch(RW_URL, { headers: RW_HEADERS });
    if (!res.ok) throw new Error(`Rotowire HTTP ${res.status}: ${res.statusText}`);
    html = await res.text();
  } catch (err) {
    const msg = `[WC2026Lineups] [VERIFY] FAIL — fetch error: ${String(err)}`;
    console.error(msg);
    return { rowsWritten: 0, gamesProcessed: 0, errors: [msg] };
  }

  const $ = cheerio.load(html);
  const cards = $("div.lineup.is-soccer");
  console.log(`[WC2026Lineups] [STEP] Found ${cards.length} lineup cards`);

  if (cards.length === 0) {
    console.log("[WC2026Lineups] [OUTPUT] No lineup cards found — no WC2026 games today");
    return { rowsWritten: 0, gamesProcessed: 0, errors: [] };
  }

  const db = await getDb();
  const errors: string[] = [];
  const insertRows: InsertWc2026Lineup[] = [];
  let gamesProcessed = 0;

  for (const cardEl of cards.toArray()) {
    const card = $(cardEl);

    // ─── Extract team abbreviations ──────────────────────────────────────────
    const homeAbbr = card.find("div.lineup__team.is-home div.lineup__abbr").first().text().trim();
    const awayAbbr = card.find("div.lineup__team.is-visit div.lineup__abbr").first().text().trim();

    console.log(
      `[WC2026Lineups] [STEP] Card: homeAbbr="${homeAbbr}" awayAbbr="${awayAbbr}"`
    );

    const [resolvedHome, resolvedAway] = await Promise.all([
      resolveWcTeam(homeAbbr),
      resolveWcTeam(awayAbbr),
    ]);

    if (!resolvedHome || !resolvedAway) {
      const msg = `[WC2026Lineups] [VERIFY] FAIL — Unresolved: home="${homeAbbr}"→${resolvedHome ?? "null"} away="${awayAbbr}"→${resolvedAway ?? "null"}`;
      console.error(msg);
      errors.push(msg);
      continue;
    }

    // ─── Find fixture ─────────────────────────────────────────────────────────
    const fixtures = await db
      .select({ matchId: wc2026Matches.matchId })
      .from(wc2026Matches)
      .where(
        and(
          eq(wc2026Matches.homeTeamId, resolvedHome),
          eq(wc2026Matches.awayTeamId, resolvedAway)
        )
      )
      .limit(1);

    const matchId = fixtures[0]?.matchId;
    if (!matchId) {
      const msg = `[WC2026Lineups] [VERIFY] FAIL — No fixture: home=${resolvedHome} away=${resolvedAway}`;
      console.error(msg);
      errors.push(msg);
      continue;
    }

    console.log(`[WC2026Lineups] [STATE] Matched match_id=${matchId}`);

    // ─── Delete stale lineup rows for this fixture ────────────────────────────
    await db
      .delete(wc2026Lineups)
      .where(eq(wc2026Lineups.matchId, matchId));

    // ─── Extract players from both lineup__main sections ─────────────────────
    // Card has two div.lineup__main: [0]=home, [1]=visit (away)
    const mainSections = card.find("div.lineup__main").toArray();

    const teamOrder: Array<{ teamId: string; label: string }> = [
      { teamId: resolvedHome, label: "home" },
      { teamId: resolvedAway, label: "away" },
    ];

    for (let sectionIdx = 0; sectionIdx < Math.min(mainSections.length, 2); sectionIdx++) {
      const section = $(mainSections[sectionIdx]);
      const { teamId, label } = teamOrder[sectionIdx];

      // Determine if confirmed
      const statusText = section.find("div.lineup__status").first().text().trim().toLowerCase();
      const isConfirmed = statusText.includes("confirmed");

      console.log(
        `[WC2026Lineups] [STATE] Team=${label}(${teamId}) status="${statusText}" confirmed=${isConfirmed}`
      );

      // Extract starters: li.lineup__player elements BEFORE li.lineup__title.is-middle
      const listItems = section.find("ul.lineup__list li").toArray();
      let hitMiddle = false;

      for (const liEl of listItems) {
        const li = $(liEl);

        // Stop at the "is-middle" divider (separates starters from bench/injuries)
        if (li.hasClass("lineup__title") && li.hasClass("is-middle")) {
          hitMiddle = true;
          continue;
        }

        if (!li.hasClass("lineup__player")) continue;

        const isStarter = !hitMiddle;
        const position = li.find("div.lineup__pos").first().text().trim() || "UNK";
        const playerName = li.find("a[title]").attr("title")?.trim() ?? li.find("a").first().text().trim();
        const injuryStatus = li.find("span.lineup__inj").first().text().trim() || null;

        if (!playerName) continue;

        console.log(
          `[WC2026Lineups] [STATE] ${label} ${position} ${playerName} starter=${isStarter} inj=${injuryStatus ?? "none"}`
        );

        insertRows.push({
          matchId,
          teamId,
          scrapedAt,
          isConfirmed,
          playerName,
          position,
          isStarter,
          injuryStatus: injuryStatus ?? undefined,
        });
      }
    }

    gamesProcessed++;
  }

  // ─── Batch insert ─────────────────────────────────────────────────────────
  let rowsWritten = 0;
  if (insertRows.length > 0) {
    try {
      const CHUNK = 200;
      for (let i = 0; i < insertRows.length; i += CHUNK) {
        await db.insert(wc2026Lineups).values(insertRows.slice(i, i + CHUNK));
        rowsWritten += insertRows.slice(i, i + CHUNK).length;
      }
      console.log(
        `[WC2026Lineups] [OUTPUT] Wrote ${rowsWritten} lineup rows for ${gamesProcessed} games`
      );
    } catch (err) {
      const msg = `[WC2026Lineups] [VERIFY] FAIL — DB insert: ${String(err)}`;
      console.error(msg);
      errors.push(msg);
    }
  }

  console.log(
    `[WC2026Lineups] [VERIFY] ${errors.length === 0 ? "PASS" : "FAIL"} — rowsWritten=${rowsWritten} gamesProcessed=${gamesProcessed} errors=${errors.length}`
  );
  return { rowsWritten, gamesProcessed, errors };
}
