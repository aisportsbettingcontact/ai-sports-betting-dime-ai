/**
 * liveSplits.ts
 *
 * Serves VSiN MLB betting splits directly from the scraper
 * (vsinBettingSplitsScraper.ts) so the mobile Splits tab does not depend on
 * the vsinAutoRefresh DB pipeline having run.
 *
 * Flow per request:
 *   1. scrapeVsinMlbBettingSplits() — today + tomorrow, deduped by gameId
 *      (in-memory cache, 5-minute TTL; stale cache served on scrape failure)
 *   2. VSiN slug → MLB abbrev via getMlbTeamByVsinSlug (alias-aware)
 *   3. Best-effort join against the games table for book lines
 *      (awayBookSpread / bookTotal / awayML) — non-fatal if the DB is down
 *   4. Team logos fetched server-side and returned as base64 data URIs
 *      (same pattern as server/discord/renderSplitsCard.ts) so the client
 *      never depends on reaching the MLB CDN directly
 */

import { scrapeVsinMlbBettingSplits, type VsinSplitsGame } from "./vsinBettingSplitsScraper";
import { getMlbTeamByVsinSlug, MLB_BY_ABBREV } from "../shared/mlbTeams";
import { listGamesByDate } from "./db";

export interface LiveSplitRow {
  /** VSiN game ID, e.g. "20260710MLB00008" */
  vsinGameId: string;
  /** YYYY-MM-DD derived from the VSiN game ID */
  gameDate: string;
  /** MLB abbrevs resolved from VSiN slugs ("MIN", "NYY") — null if unresolved */
  awayAbbrev: string | null;
  homeAbbrev: string | null;
  /** VSiN display names — always present, used as fallback labels */
  awayName: string;
  homeName: string;
  spreadAwayMoneyPct: number | null;
  spreadAwayBetsPct: number | null;
  totalOverMoneyPct: number | null;
  totalOverBetsPct: number | null;
  mlAwayMoneyPct: number | null;
  mlAwayBetsPct: number | null;
  /** Book lines from the games table (DB-oriented to VSiN's away team) — null if no DB match */
  dbGameId: number | null;
  awayBookSpread: string | null;
  homeBookSpread: string | null;
  bookTotal: string | null;
  awayML: string | null;
  homeML: string | null;
  startTimeEst: string | null;
}

export interface LiveSplitsResult {
  fetchedAt: string;
  fromCache: boolean;
  rows: LiveSplitRow[];
  /** MLB abbrev → base64 data URI of the official team logo (server-fetched) */
  logos: Record<string, string>;
}

interface CachePayload {
  rows: LiveSplitRow[];
  logos: Record<string, string>;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { at: number; payload: CachePayload } | null = null;
let inflight: Promise<CachePayload> | null = null;

// ─── Logo cache: URL → base64 data URI (per-process, same as renderSplitsCard) ─
const logoCache = new Map<string, string>();

async function fetchLogoAsDataUri(url: string): Promise<string | null> {
  const cached = logoCache.get(url);
  if (cached) return cached;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      console.warn(`[LiveSplits] Logo fetch failed (${res.status}): ${url}`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") ?? "image/svg+xml";
    const dataUri = `data:${contentType};base64,${buf.toString("base64")}`;
    logoCache.set(url, dataUri);
    return dataUri;
  } catch (err) {
    console.warn(`[LiveSplits] Logo fetch error: ${url} —`, err instanceof Error ? err.message : err);
    return null;
  }
}

/** Fetch logos for every resolved team in the rows, in parallel, deduped by abbrev. */
async function fetchLogos(rows: LiveSplitRow[]): Promise<Record<string, string>> {
  const wanted = new Map<string, string>(); // abbrev → logoUrl
  for (const row of rows) {
    for (const abbrev of [row.awayAbbrev, row.homeAbbrev]) {
      if (!abbrev || wanted.has(abbrev)) continue;
      const team = MLB_BY_ABBREV.get(abbrev);
      if (team?.logoUrl) wanted.set(abbrev, team.logoUrl);
    }
  }
  const logos: Record<string, string> = {};
  await Promise.all(
    Array.from(wanted.entries()).map(async ([abbrev, url]) => {
      const dataUri = await fetchLogoAsDataUri(url);
      if (dataUri) logos[abbrev] = dataUri;
    })
  );
  console.log(`[LiveSplits] Logos resolved: ${Object.keys(logos).length}/${wanted.size} teams`);
  return logos;
}

/** "20260710MLB00008" → "2026-07-10" */
function gameDateFromVsinId(gameId: string): string {
  return `${gameId.slice(0, 4)}-${gameId.slice(4, 6)}-${gameId.slice(6, 8)}`;
}

function buildBaseRows(games: VsinSplitsGame[]): LiveSplitRow[] {
  return games.map((g) => {
    const awayTeam = getMlbTeamByVsinSlug(g.awayVsinSlug);
    const homeTeam = getMlbTeamByVsinSlug(g.homeVsinSlug);
    if (!awayTeam || !homeTeam) {
      console.warn(
        `[LiveSplits] UNRESOLVED VSiN slug: "${g.awayVsinSlug}" @ "${g.homeVsinSlug}" ` +
        `— awayResolved=${!!awayTeam} homeResolved=${!!homeTeam}`
      );
    }
    return {
      vsinGameId: g.gameId,
      gameDate: gameDateFromVsinId(g.gameId),
      awayAbbrev: awayTeam?.abbrev ?? null,
      homeAbbrev: homeTeam?.abbrev ?? null,
      awayName: g.awayName,
      homeName: g.homeName,
      spreadAwayMoneyPct: g.spreadAwayMoneyPct,
      spreadAwayBetsPct: g.spreadAwayBetsPct,
      totalOverMoneyPct: g.totalOverMoneyPct,
      totalOverBetsPct: g.totalOverBetsPct,
      mlAwayMoneyPct: g.mlAwayMoneyPct,
      mlAwayBetsPct: g.mlAwayBetsPct,
      dbGameId: null,
      awayBookSpread: null,
      homeBookSpread: null,
      bookTotal: null,
      awayML: null,
      homeML: null,
      startTimeEst: null,
    };
  });
}

/**
 * Join book lines from the games table onto the scraped rows.
 * Matches by abbrev pair on the row's own date; tries the swapped ordering
 * too (VSiN and DB occasionally disagree on home/away) and flips the away
 * line fields when swapped. Non-fatal: on DB failure rows keep null lines.
 */
async function joinDbLines(rows: LiveSplitRow[]): Promise<void> {
  const dates = Array.from(new Set(rows.map((r) => r.gameDate)));
  for (const date of dates) {
    let dbGames;
    try {
      dbGames = await listGamesByDate(date, "MLB");
    } catch (err) {
      console.warn(`[LiveSplits] DB join skipped for ${date} (non-fatal):`, err);
      continue;
    }
    for (const row of rows) {
      if (row.gameDate !== date || !row.awayAbbrev || !row.homeAbbrev) continue;
      const direct = dbGames.find(
        (g) => g.awayTeam === row.awayAbbrev && g.homeTeam === row.homeAbbrev
      );
      const swapped = direct
        ? undefined
        : dbGames.find((g) => g.awayTeam === row.homeAbbrev && g.homeTeam === row.awayAbbrev);
      const dbGame = direct ?? swapped;
      if (!dbGame) continue;
      row.dbGameId = dbGame.id;
      row.startTimeEst = dbGame.startTimeEst ?? null;
      // Orient lines to VSiN's away team: if the DB has teams reversed,
      // the DB *home* line is VSiN's away line.
      row.awayBookSpread = (direct ? dbGame.awayBookSpread : dbGame.homeBookSpread) ?? null;
      row.homeBookSpread = (direct ? dbGame.homeBookSpread : dbGame.awayBookSpread) ?? null;
      row.awayML = (direct ? dbGame.awayML : dbGame.homeML) ?? null;
      row.homeML = (direct ? dbGame.homeML : dbGame.awayML) ?? null;
      row.bookTotal = dbGame.bookTotal ?? null;
    }
  }
}

async function fetchPayload(): Promise<CachePayload> {
  const games = await scrapeVsinMlbBettingSplits();
  const rows = buildBaseRows(games);
  const [logos] = await Promise.all([fetchLogos(rows), joinDbLines(rows)]);
  return { rows, logos };
}

/**
 * Get live MLB splits, cached for 5 minutes.
 * Concurrent callers share one in-flight scrape.
 * On scrape failure, serves the last good result if one exists.
 */
export async function getLiveMlbSplits(): Promise<LiveSplitsResult> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) {
    return { fetchedAt: new Date(cache.at).toISOString(), fromCache: true, ...cache.payload };
  }
  if (!inflight) {
    inflight = fetchPayload().finally(() => { inflight = null; });
  }
  try {
    const payload = await inflight;
    cache = { at: Date.now(), payload };
    return { fetchedAt: new Date(cache.at).toISOString(), fromCache: false, ...payload };
  } catch (err) {
    if (cache) {
      console.warn("[LiveSplits] Scrape failed — serving stale cache (non-fatal):", err);
      return { fetchedAt: new Date(cache.at).toISOString(), fromCache: true, ...cache.payload };
    }
    throw err;
  }
}
