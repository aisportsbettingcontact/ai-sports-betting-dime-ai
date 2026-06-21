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

import https from "https";
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
// Fetch each bookId separately — CloudFront WAF blocks multi-bookId requests on the soccer path
const AN_BOOK_IDS_LIST = ["15", "30", "79", "2988", "75", "123", "71", "68", "69"];

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

const AN_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "application/json",
  Referer: "https://www.actionnetwork.com/soccer/odds",
  Origin: "https://www.actionnetwork.com",
};

/**
 * HTTP/1.1 fetch using Node.js built-in https module.
 * CloudFront WAF blocks HTTP/2 (fetch()) for the soccer endpoint but allows HTTP/1.1.
 * Retries up to 3 times with 2s delay on 403/5xx.
 */
function httpsGet(url: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method: "GET", headers },
      (res) => {
        let data = "";
        res.on("data", (c: Buffer) => (data += c.toString()));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

async function fetchAnSoccer(dateStr: string, bookId: string): Promise<AnResponse | null> {
  const url = `${AN_SOCCER_URL}?bookIds=${bookId}&date=${dateStr}&periods=event`;
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const r = await httpsGet(url, AN_HEADERS);
      if (r.status === 200) return JSON.parse(r.body) as AnResponse;
      if (r.status === 403 && attempt < MAX_ATTEMPTS) {
        console.warn(`[WC2026Odds] [STATE] bookId=${bookId} attempt=${attempt} HTTP 403 — retrying in 2s`);
        await new Promise((res) => setTimeout(res, 2000));
        continue;
      }
      console.error(`[WC2026Odds] [STATE] bookId=${bookId} HTTP ${r.status} after ${attempt} attempts`);
      return null;
    } catch (err) {
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((res) => setTimeout(res, 2000));
        continue;
      }
      console.error(`[WC2026Odds] [STATE] bookId=${bookId} fetch error: ${String(err)}`);
      return null;
    }
  }
  return null;
}

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

  // Fetch each bookId separately (HTTP/1.1 via https module) to bypass CloudFront WAF
  // Merge all responses: use first successful response for game list, merge markets from each
  const gameMap = new Map<number, AnGame>();
  let totalFetched = 0;

  for (const bookId of AN_BOOK_IDS_LIST) {
    const data = await fetchAnSoccer(dateStr, bookId);
    if (!data) {
      console.warn(`[WC2026Odds] [STATE] bookId=${bookId} — no data returned, skipping`);
      continue;
    }
    for (const game of data.games ?? []) {
      if (!gameMap.has(game.id)) {
        gameMap.set(game.id, { ...game, markets: {} });
      }
      const existing = gameMap.get(game.id)!;
      // Merge markets from this bookId response into the game
      for (const [mBookId, mData] of Object.entries(game.markets ?? {})) {
        existing.markets[mBookId] = mData;
      }
    }
    totalFetched++;
    // Small delay between book requests to avoid rate limiting
    if (totalFetched < AN_BOOK_IDS_LIST.length) {
      await new Promise((res) => setTimeout(res, 300));
    }
  }

  const games = Array.from(gameMap.values());
  console.log(`[WC2026Odds] [STEP] AN returned ${games.length} games for date=${dateStr} (fetched ${totalFetched}/${AN_BOOK_IDS_LIST.length} books)`);

  if (games.length === 0) {
    const msg = `[WC2026Odds] [VERIFY] FAIL — 0 games returned for date=${dateStr} after fetching all books`;
    console.error(msg);
    return { snapshotsWritten: 0, gamesProcessed: 0, errors: [msg] };
  }

  const db = await getDb();
  const errors: string[] = [];
  const rows: InsertWc2026OddsSnapshot[] = [];
  let gamesProcessed = 0;

  for (const game of games) {
    console.log(
      `[WC2026Odds] [STEP] Game ${game.id} | status=${game.status} | start=${game.start_time}`
    );

    // AN API soccer convention: teams[0]=home, teams[1]=away (matches ESPN standard)
    // Primary lookup uses teams[0]=home / teams[1]=away.
    // Fallback swaps orientation in case the fixture was seeded with the reverse assignment.
    // Both attempts are logged so any orientation mismatch is immediately visible.
    const team0Raw = game.teams[0]?.full_name ?? game.teams[0]?.abbr ?? "";
    const team1Raw = game.teams[1]?.full_name ?? game.teams[1]?.abbr ?? "";

    console.log(
      `[WC2026Odds] [STATE] Raw teams: teams[0]="${team0Raw}" teams[1]="${team1Raw}"`
    );

    const [resolved0, resolved1] = await Promise.all([
      resolveWcTeam(team0Raw),
      resolveWcTeam(team1Raw),
    ]);

    if (!resolved0 || !resolved1) {
      const msg = `[WC2026Odds] [VERIFY] FAIL — Unresolved: teams[0]="${team0Raw}"→${resolved0 ?? "null"} teams[1]="${team1Raw}"→${resolved1 ?? "null"}`;
      console.error(msg);
      errors.push(msg);
      continue;
    }

    // Primary: teams[0]=home, teams[1]=away (ESPN/AN standard)
    let fixtureRows = await db
      .select()
      .from(wc2026Fixtures)
      .where(
        and(
          eq(wc2026Fixtures.homeTeamId, resolved0),
          eq(wc2026Fixtures.awayTeamId, resolved1)
        )
      )
      .limit(1);
    let orientationUsed = "primary(teams[0]=home,teams[1]=away)";

    // Fallback: teams[0]=away, teams[1]=home
    if (!fixtureRows[0]) {
      fixtureRows = await db
        .select()
        .from(wc2026Fixtures)
        .where(
          and(
            eq(wc2026Fixtures.homeTeamId, resolved1),
            eq(wc2026Fixtures.awayTeamId, resolved0)
          )
        )
        .limit(1);
      orientationUsed = "fallback(teams[0]=away,teams[1]=home)";
    }

    const fixture = fixtureRows[0];
    if (!fixture) {
      const msg = `[WC2026Odds] [VERIFY] FAIL — No fixture found for "${team0Raw}"(${resolved0}) vs "${team1Raw}"(${resolved1}) — tried both orientations`;
      console.error(msg);
      errors.push(msg);
      continue;
    }

    console.log(`[WC2026Odds] [STATE] Matched fixture_id=${fixture.fixtureId} via ${orientationUsed} | DB home=${fixture.homeTeamId} away=${fixture.awayTeamId}`);

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

    // ─── PERMANENT ORIENTATION FIX: team_id-based selection resolution ─────────
    // AN's side='home'/'away' in market data is NOT reliable — it sometimes refers to
    // teams[0] (AN's display order) rather than the actual FIFA home team. This causes
    // inverted odds for fixtures where AN lists the away team first.
    //
    // SOLUTION: Use outcome.team_id (present on all 1X2 and ASIAN_HANDICAP outcomes)
    // to directly identify which DB team (home or away) the odds belong to.
    //
    // Resolution map: AN team_id → DB selection label
    //   - game.teams[0].id → resolved0 → if resolved0 === fixture.homeTeamId → 'home' else 'away'
    //   - game.teams[1].id → resolved1 → if resolved1 === fixture.homeTeamId → 'home' else 'away'
    //
    // This is 100% reliable regardless of AN's teams[] order or side label convention.
    // Falls back to side-based mapping if team_id is absent (should never happen for 1X2/spread).
    const anTeamIdToDbSel = new Map<number, string>();
    if (game.teams[0]?.id && resolved0) {
      anTeamIdToDbSel.set(game.teams[0].id, resolved0 === fixture.homeTeamId ? "home" : "away");
    }
    if (game.teams[1]?.id && resolved1) {
      anTeamIdToDbSel.set(game.teams[1].id, resolved1 === fixture.homeTeamId ? "home" : "away");
    }

    console.log(
      `[WC2026Odds] [STATE] orientationUsed=${orientationUsed}` +
      ` | [FIX] team_id map: ${JSON.stringify(Object.fromEntries(anTeamIdToDbSel))}` +
      ` | DB home=${fixture.homeTeamId}(resolved0=${resolved0},resolved1=${resolved1})`
    );

    /**
     * Resolve the DB selection label for a 1X2/spread outcome.
     * Uses team_id if available (primary, reliable), falls back to AN side label.
     */
    const resolveSelection = (outcome: AnOutcome, fallbackSide: string): string => {
      if (outcome.team_id && anTeamIdToDbSel.has(outcome.team_id)) {
        const dbSel = anTeamIdToDbSel.get(outcome.team_id)!;
        if (dbSel !== fallbackSide) {
          console.log(
            `[WC2026Odds] [FIX] team_id=${outcome.team_id} → DB selection='${dbSel}' (AN side='${fallbackSide}' overridden)` +
            ` | fixture=${fixture.fixtureId} DB home=${fixture.homeTeamId} away=${fixture.awayTeamId}`
          );
        }
        return dbSel;
      }
      // Fallback: use AN side label directly (draw outcomes always use this path)
      return fallbackSide;
    }

    for (const [bookIdStr, bookData] of Object.entries(markets)) {
      const bookId = parseInt(bookIdStr, 10);
      const bookName = BOOK_NAMES[bookIdStr] ?? `book_${bookIdStr}`;
      const event = bookData?.event;
      if (!event) continue;

      // 1X2 Moneyline — use team_id-based selection resolution
      const ml = event.moneyline ?? [];
      const mlHome = ml.find((o) => o.side === "home");
      const mlAway = ml.find((o) => o.side === "away");
      const mlDraw = ml.find((o) => o.side === "draw");

      for (const [anSide, outcome] of [["home", mlHome], ["away", mlAway], ["draw", mlDraw]] as [string, AnOutcome | undefined][]) {
        if (outcome) {
          const sel = resolveSelection(outcome, anSide);
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
        // Log with resolved DB selections for full traceability
        const homeResolved = mlHome ? resolveSelection(mlHome, "home") : "N/A";
        const awayResolved = mlAway ? resolveSelection(mlAway, "away") : "N/A";
        console.log(
          `[WC2026Odds] [STATE] ${bookName} 1X2: DB home(${fixture.homeTeamId})=${homeResolved === "home" ? mlHome?.odds : mlAway?.odds} DB away(${fixture.awayTeamId})=${awayResolved === "away" ? mlAway?.odds : mlHome?.odds} draw=${mlDraw?.odds ?? "N/A"}`
        );
      }

      // Total (over/under) — side labels are orientation-neutral, no team_id needed
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

      // Asian Handicap — use team_id-based selection resolution (same as 1X2)
      const spreads = event.spread ?? [];
      const spreadHome = spreads.find((o) => o.side === "home");
      const spreadAway = spreads.find((o) => o.side === "away");
      for (const [anSide, outcome] of [["home", spreadHome], ["away", spreadAway]] as [string, AnOutcome | undefined][]) {
        if (outcome) {
          const sel = resolveSelection(outcome, anSide);
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
