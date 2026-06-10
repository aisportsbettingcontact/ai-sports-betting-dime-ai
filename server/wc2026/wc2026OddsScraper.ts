/**
 * wc2026OddsScraper.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Fetches WC2026 odds from Action Network v2 scoreboard API and writes
 * snapshots to wc2026_odds_snapshots + updates kickoff_utc on fixtures.
 *
 * AN API:
 *   GET https://api.actionnetwork.com/web/v2/scoreboard/soccer
 *     ?bookIds=15,30,79,2988,75,123,71,68,69
 *     &date=YYYYMMDD
 *     &periods=event
 *
 * Logging format:
 *   [WC2026Odds] [INPUT]  → date, game count
 *   [WC2026Odds] [STEP]   → per-game processing
 *   [WC2026Odds] [STATE]  → per-book odds extraction
 *   [WC2026Odds] [OUTPUT] → rows written
 *   [WC2026Odds] [VERIFY] → PASS / FAIL + reason
 */

import { getDb } from "../db";
import {
  wc2026Fixtures,
  wc2026OddsSnapshots,
  type InsertWc2026OddsSnapshot,
} from "../../drizzle/wc2026.schema";
import { resolveWcTeam } from "./resolveWcTeam";
import { eq, and } from "drizzle-orm";

// ─── Constants ────────────────────────────────────────────────────────────────
const AN_SOCCER_URL = "https://api.actionnetwork.com/web/v2/scoreboard/soccer";
const AN_BOOK_IDS = "15,30,79,2988,75,123,71,68,69";

const BOOK_NAMES: Record<string, string> = {
  "15": "consensus",
  "30": "open",
  "68": "DraftKings",
  "69": "FanDuel",
  "71": "BetMGM",
  "75": "Caesars",
  "79": "bet365",
  "123": "BetRivers",
  "2988": "Fanatics",
};

const AN_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "application/json",
  Referer: "https://www.actionnetwork.com/soccer/odds",
  Origin: "https://www.actionnetwork.com",
};

// ─── Type definitions for AN response ────────────────────────────────────────
interface AnOutcome {
  side: string;
  odds: number;
  value?: number;
  team_id?: number;
}

interface AnBookEvent {
  moneyline?: AnOutcome[];
  total?: AnOutcome[];
  spread?: AnOutcome[];
}

interface AnTeam {
  full_name: string;
  abbr: string;
  id: number;
}

interface AnGame {
  id: number;
  start_time: string;
  status: string;
  teams: AnTeam[];
  markets: Record<string, { event?: AnBookEvent }>;
}

interface AnResponse {
  games: AnGame[];
}

// ─── American odds → implied probability ─────────────────────────────────────
function americanToImplied(odds: number): number {
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

function toAnDateStr(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

// ─── Main scraper ─────────────────────────────────────────────────────────────
export async function scrapeWc2026Odds(opts?: {
  dateUtc?: Date;
  isClosing?: boolean;
}): Promise<{ snapshotsWritten: number; gamesProcessed: number; errors: string[] }> {
  const dateUtc = opts?.dateUtc ?? new Date();
  const isClosing = opts?.isClosing ?? false;
  const dateStr = toAnDateStr(dateUtc);
  const snapshotTs = new Date();

  console.log(
    `[WC2026Odds] [INPUT] date=${dateStr} isClosing=${isClosing} ts=${snapshotTs.toISOString()}`
  );

  const url = `${AN_SOCCER_URL}?bookIds=${AN_BOOK_IDS}&date=${dateStr}&periods=event`;
  let anData: AnResponse;

  try {
    const res = await fetch(url, { headers: AN_HEADERS });
    if (!res.ok) throw new Error(`AN HTTP ${res.status}: ${res.statusText}`);
    anData = (await res.json()) as AnResponse;
  } catch (err) {
    const msg = `[WC2026Odds] [VERIFY] FAIL — AN fetch error: ${String(err)}`;
    console.error(msg);
    return { snapshotsWritten: 0, gamesProcessed: 0, errors: [msg] };
  }

  const games = anData.games ?? [];
  console.log(`[WC2026Odds] [STEP] AN returned ${games.length} games for date=${dateStr}`);

  if (games.length === 0) {
    console.log(`[WC2026Odds] [OUTPUT] No games found for date=${dateStr}`);
    return { snapshotsWritten: 0, gamesProcessed: 0, errors: [] };
  }

  const db = await getDb();
  const errors: string[] = [];
  const rows: InsertWc2026OddsSnapshot[] = [];
  let gamesProcessed = 0;

  for (const game of games) {
    console.log(
      `[WC2026Odds] [STEP] Game ${game.id} | status=${game.status} | start=${game.start_time}`
    );

    // AN soccer: teams[0]=away, teams[1]=home
    const awayTeamRaw = game.teams[0]?.full_name ?? game.teams[0]?.abbr ?? "";
    const homeTeamRaw = game.teams[1]?.full_name ?? game.teams[1]?.abbr ?? "";

    console.log(
      `[WC2026Odds] [STATE] Raw teams: away="${awayTeamRaw}" home="${homeTeamRaw}"`
    );

    const [resolvedAway, resolvedHome] = await Promise.all([
      resolveWcTeam(awayTeamRaw),
      resolveWcTeam(homeTeamRaw),
    ]);

    if (!resolvedAway || !resolvedHome) {
      const msg = `[WC2026Odds] [VERIFY] FAIL — Unresolved: away="${awayTeamRaw}"→${resolvedAway ?? "null"} home="${homeTeamRaw}"→${resolvedHome ?? "null"}`;
      console.error(msg);
      errors.push(msg);
      continue;
    }

    const fixtures = await db
      .select()
      .from(wc2026Fixtures)
      .where(
        and(
          eq(wc2026Fixtures.awayTeamId, resolvedAway),
          eq(wc2026Fixtures.homeTeamId, resolvedHome)
        )
      )
      .limit(1);

    const fixture = fixtures[0];
    if (!fixture) {
      const msg = `[WC2026Odds] [VERIFY] FAIL — No fixture: away=${resolvedAway} home=${resolvedHome}`;
      console.error(msg);
      errors.push(msg);
      continue;
    }

    console.log(`[WC2026Odds] [STATE] Matched fixture_id=${fixture.fixtureId}`);

    // Update kickoff_utc if not set
    if (!fixture.kickoffUtc && game.start_time) {
      await db
        .update(wc2026Fixtures)
        .set({ kickoffUtc: new Date(game.start_time) })
        .where(eq(wc2026Fixtures.fixtureId, fixture.fixtureId));
      console.log(
        `[WC2026Odds] [STEP] Set kickoff_utc=${game.start_time} for fixture_id=${fixture.fixtureId}`
      );
    }

    const markets = game.markets ?? {};
    let bookCount = 0;

    for (const [bookIdStr, bookData] of Object.entries(markets)) {
      const bookId = parseInt(bookIdStr, 10);
      const bookName = BOOK_NAMES[bookIdStr] ?? `book_${bookIdStr}`;
      const event = bookData?.event;
      if (!event) continue;

      // 1X2 Moneyline
      const ml = event.moneyline ?? [];
      const mlHome = ml.find((o) => o.side === "home");
      const mlAway = ml.find((o) => o.side === "away");
      const mlDraw = ml.find((o) => o.side === "draw");

      for (const [sel, outcome] of [["home", mlHome], ["away", mlAway], ["draw", mlDraw]] as [string, AnOutcome | undefined][]) {
        if (outcome) {
          rows.push({
            fixtureId: fixture.fixtureId,
            snapshotTs,
            bookId,
            market: "1X2",
            selection: sel,
            americanOdds: outcome.odds,
            impliedProb: americanToImplied(outcome.odds),
            isClosing,
          });
        }
      }
      if (mlHome || mlAway || mlDraw) {
        console.log(
          `[WC2026Odds] [STATE] ${bookName} 1X2: home=${mlHome?.odds ?? "N/A"} away=${mlAway?.odds ?? "N/A"} draw=${mlDraw?.odds ?? "N/A"}`
        );
      }

      // Total (over/under)
      const totals = event.total ?? [];
      const over = totals.find((o) => o.side === "over");
      const under = totals.find((o) => o.side === "under");
      for (const [sel, outcome] of [["over", over], ["under", under]] as [string, AnOutcome | undefined][]) {
        if (outcome) {
          rows.push({
            fixtureId: fixture.fixtureId,
            snapshotTs,
            bookId,
            market: "TOTAL",
            selection: sel,
            line: outcome.value ?? null,
            americanOdds: outcome.odds,
            impliedProb: americanToImplied(outcome.odds),
            isClosing,
          });
        }
      }
      if (over || under) {
        console.log(
          `[WC2026Odds] [STATE] ${bookName} TOTAL: line=${over?.value ?? under?.value ?? "N/A"} over=${over?.odds ?? "N/A"} under=${under?.odds ?? "N/A"}`
        );
      }

      // Asian Handicap
      const spreads = event.spread ?? [];
      const spreadHome = spreads.find((o) => o.side === "home");
      const spreadAway = spreads.find((o) => o.side === "away");
      for (const [sel, outcome] of [["home", spreadHome], ["away", spreadAway]] as [string, AnOutcome | undefined][]) {
        if (outcome) {
          rows.push({
            fixtureId: fixture.fixtureId,
            snapshotTs,
            bookId,
            market: "ASIAN_HANDICAP",
            selection: sel,
            line: outcome.value ?? null,
            americanOdds: outcome.odds,
            impliedProb: americanToImplied(outcome.odds),
            isClosing,
          });
        }
      }
      if (spreadHome || spreadAway) {
        console.log(
          `[WC2026Odds] [STATE] ${bookName} HANDICAP: home=${spreadHome?.value ?? "N/A"}@${spreadHome?.odds ?? "N/A"} away=${spreadAway?.value ?? "N/A"}@${spreadAway?.odds ?? "N/A"}`
        );
      }

      bookCount++;
    }

    console.log(
      `[WC2026Odds] [STEP] Game ${game.id}: ${bookCount} books, cumulative rows=${rows.length}`
    );
    gamesProcessed++;
  }

  // Batch insert in chunks of 500
  let snapshotsWritten = 0;
  if (rows.length > 0) {
    try {
      const CHUNK = 500;
      for (let i = 0; i < rows.length; i += CHUNK) {
        await db.insert(wc2026OddsSnapshots).values(rows.slice(i, i + CHUNK));
        snapshotsWritten += rows.slice(i, i + CHUNK).length;
      }
      console.log(
        `[WC2026Odds] [OUTPUT] Wrote ${snapshotsWritten} rows for ${gamesProcessed} games`
      );
    } catch (err) {
      const msg = `[WC2026Odds] [VERIFY] FAIL — DB insert: ${String(err)}`;
      console.error(msg);
      errors.push(msg);
    }
  }

  console.log(
    `[WC2026Odds] [VERIFY] ${errors.length === 0 ? "PASS" : "FAIL"} — snapshotsWritten=${snapshotsWritten} gamesProcessed=${gamesProcessed} errors=${errors.length}`
  );
  return { snapshotsWritten, gamesProcessed, errors };
}
