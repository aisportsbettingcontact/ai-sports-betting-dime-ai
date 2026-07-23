/**
 * fifaLiveScraper.ts — WC2026 Live Match Status Scraper (FIFA API v4)
 *
 * DATA SOURCE: https://api.fifa.com/api/v3/live/football?language=en&count=100
 * This is the internal FIFA API used by FIFA.com's SPA. Returns live matches
 * with numeric MatchStatus + Period codes.
 *
 * FIFA STATUS CODE MAP:
 *   MatchStatus=0, Period=null  → FT        (match complete)
 *   MatchStatus=1, Period=0     → SCHEDULED (not started)
 *   MatchStatus=1, Period=1/2   → LIVE       (1st/2nd half)
 *   MatchStatus=3, Period=5     → HT         (regular halftime)
 *   MatchStatus=3, Period=6     → HT + ETHT  (ET halftime)
 *   MatchStatus=3, Period=3/4   → ET         (ET 1st/2nd half)
 *   MatchStatus=3, Period=11    → SHOOTOUT   (penalty shootout)
 *
 * 2026-06-30 v4 (FIFA API rewrite, no HTML scraping)
 */

import type { Request, Response } from 'express';
import { requireCronSecret } from '../cron/cronAuth';
import { notifyOwner } from '../_core/notification';
import { getDb } from '../db';
import { wc2026Matches } from '../../drizzle/wc2026.schema';
import { eq, isNotNull } from 'drizzle-orm';

type ScrapeLevel = 'INPUT'|'STEP'|'STATE'|'OUTPUT'|'VERIFY'|'PASS'|'FAIL'|'WARN'|'DB'|'SKIP'|'AUDIT';
const ICONS: Record<ScrapeLevel,string> = {
  INPUT:'📥',STEP:'▶ ',STATE:'🔄',OUTPUT:'📤',VERIFY:'🔍',
  PASS:'✅',FAIL:'❌',WARN:'⚠️ ',DB:'🗄️ ',SKIP:'⏭️ ',AUDIT:'📋',
};
function ts(): string { return new Date().toISOString().replace('T',' ').replace('Z',''); }
let stepN = 0;
function S(): string { return `S${++stepN}`; }
function log(level: ScrapeLevel, step: string, msg: string, detail?: string): void {
  const icon = ICONS[level] ?? '  ';
  const prefix = `[${ts()}] [WC26-LIVE] [${level.padEnd(6)}] [${step.padEnd(8)}]`;
  console.log(`${prefix} ${icon} ${msg}${detail ? `\n${' '.repeat(55)}↳ ${detail}` : ''}`);
}

const FIFA_API_URL = 'https://api.fifa.com/api/v3/live/football?language=en&count=100';
const FIFA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
};

type DbStatus = 'SCHEDULED'|'LIVE'|'HT'|'ET'|'SHOOTOUT'|'FT'|'FT_PEN';

interface FifaMatchState {
  fifaMatchId: string;
  status: DbStatus;
  minute: string|null;
  homeScore: number|null;
  awayScore: number|null;
  homePenScore: number|null;  // penalty shootout score
  awayPenScore: number|null;
  fifaWinnerId: string|null;  // FIFA team ID of winner (for shootout/AET)
  homeTeamFifaId: string|null;
  awayTeamFifaId: string|null;
  rawMatchStatus: number;
  rawPeriod: number|null;
}

function normalizeMatchTime(raw: string|null): string|null {
  if (!raw || raw==='' || raw==="0'") return null;
  const injuryMid = raw.match(/^(\d+)'\+(\d+)'$/);
  if (injuryMid) return `${injuryMid[1]}+${injuryMid[2]}`;
  const injuryLegacy = raw.match(/^(\d+)\+(\d+)'$/);
  if (injuryLegacy) return `${injuryLegacy[1]}+${injuryLegacy[2]}`;
  const regular = raw.match(/^(\d+)'$/);
  if (regular) return regular[1];
  const bare = raw.match(/^(\d+)$/);
  if (bare) return bare[1];
  return null;
}

function resolveStatus(matchStatus: number, period: number|null, matchTime: string|null): {status: DbStatus; minute: string|null} {
  // matchStatus=0 means completed — but if penalty scores exist, it's FT_PEN
  // (penalty detection happens downstream after we know pen scores)
  if (matchStatus === 0) return {status:'FT', minute:null};
  if (matchStatus === 3) {
    switch (period) {
      case 5:  return {status:'HT',       minute:null};
      case 6:  return {status:'HT',       minute:'ETHT'};
      case 3:  return {status:'ET',       minute:normalizeMatchTime(matchTime)};
      case 4:  return {status:'ET',       minute:normalizeMatchTime(matchTime)};
      case 11: return {status:'SHOOTOUT', minute:'PENS'};
      default: return {status:'LIVE',     minute:normalizeMatchTime(matchTime)};
    }
  }
  if (matchStatus === 1) {
    if (!period) return {status:'SCHEDULED', minute:null};
    return {status:'LIVE', minute:normalizeMatchTime(matchTime)};
  }
  return {status:'SCHEDULED', minute:null};
}

interface FifaApiMatch {
  IdMatch: string;
  MatchStatus: number;
  Period?: number|null;
  MatchTime?: string|null;
  HomeTeam?: {Score?: number|null; IdTeam?: string|null};
  AwayTeam?: {Score?: number|null; IdTeam?: string|null};
  HomeTeamPenaltyScore?: number|null;
  AwayTeamPenaltyScore?: number|null;
  Winner?: string|null; // FIFA team ID of the winner (for shootout)
}

async function fetchFifaLiveMatches(): Promise<FifaMatchState[]> {
  log('STEP', S(), `Fetching FIFA API: ${FIFA_API_URL}`);
  const t0 = Date.now();
  const resp = await fetch(FIFA_API_URL, {headers: FIFA_HEADERS});
  log('STATE', S(), `HTTP ${resp.status} in ${Date.now()-t0}ms`);
  if (!resp.ok) throw new Error(`FIFA API HTTP ${resp.status}: ${resp.statusText}`);
  const data = await resp.json() as {Results?: FifaApiMatch[]};
  const matches = data.Results ?? [];
  log('STATE', S(), `Received ${matches.length} live matches from FIFA API`);
  return matches.map(m => {
    const {status, minute} = resolveStatus(m.MatchStatus, m.Period ?? null, m.MatchTime ?? null);
    return {
      fifaMatchId: m.IdMatch,
      status, minute,
      homeScore: m.HomeTeam?.Score ?? null,
      awayScore: m.AwayTeam?.Score ?? null,
      homePenScore: m.HomeTeamPenaltyScore ?? null,
      awayPenScore: m.AwayTeamPenaltyScore ?? null,
      fifaWinnerId: m.Winner ?? null,
      homeTeamFifaId: m.HomeTeam?.IdTeam ?? null,
      awayTeamFifaId: m.AwayTeam?.IdTeam ?? null,
      rawMatchStatus: m.MatchStatus,
      rawPeriod: m.Period ?? null,
    };
  });
}

export async function wc2026LiveSyncHandler(req: Request, res: Response): Promise<void> {
  if (!requireCronSecret(req, res, "wc2026-live-sync")) return;

  stepN = 0;
  const startMs = Date.now();
  log('INPUT', S(), '═══ WC2026 Live Sync — FIFA API v4 ═══');
  log('INPUT', S(), `Trigger: ${req.method} ${req.path}`);
  let updatedCount=0, skippedCount=0, failCount=0, warnCount=0;

  try {
    const db = await getDb();

    // Load all matches that have a fifaMatchId
    log('STEP', S(), 'Loading tracked matches from DB');
    const allMatches = await db.select({
      matchId: wc2026Matches.matchId,
      fifaMatchId: wc2026Matches.fifaMatchId,
      status: wc2026Matches.status,
      homeScore: wc2026Matches.homeScore,
      awayScore: wc2026Matches.awayScore,
      matchMinute: wc2026Matches.matchMinute,
      homeTeamId: wc2026Matches.homeTeamId,
      awayTeamId: wc2026Matches.awayTeamId,
      advancingTeamId: wc2026Matches.advancingTeamId,
    }).from(wc2026Matches).where(isNotNull(wc2026Matches.fifaMatchId));

    log('STATE', S(), `Tracking ${allMatches.length} matches with fifaMatchId`);
    if (allMatches.length === 0) {
      log('WARN', S(), 'No matches have fifaMatchId — nothing to update');
      res.json({updated:0, skipped:0, errors:0});
      return;
    }

    type DbMatch = (typeof allMatches)[0];
    const fifaToMatch = new Map<string, DbMatch>(allMatches.map((f: DbMatch) => [f.fifaMatchId!, f] as [string, DbMatch]));
    const trackedIds = new Set(fifaToMatch.keys());
    log('AUDIT', S(), `Tracked FIFA IDs: ${Array.from(trackedIds).join(', ')}`);

    // Fetch live data from FIFA API
    let liveMatches: FifaMatchState[];
    try {
      liveMatches = await fetchFifaLiveMatches();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log('FAIL', S(), `FIFA API fetch failed: ${msg}`);
      notifyOwner({ title: "[HB] fifa-live-sync FAIL", content: `FIFA API fetch: ${msg}`.slice(0, 500) });
      res.status(500).json({error:'FIFA API fetch failed', detail:msg});
      return;
    }

    // Filter to our tracked matches
    const relevant = liveMatches.filter(m => trackedIds.has(m.fifaMatchId));
    log('STATE', S(), `${relevant.length}/${liveMatches.length} live matches match our tracked matches`);
    for (const m of relevant) {
      log('AUDIT', S(), `fifaId=${m.fifaMatchId} rawStatus=${m.rawMatchStatus} period=${m.rawPeriod} → dbStatus=${m.status} minute=${m.minute??'null'} score=${m.homeScore??'?'}-${m.awayScore??'?'}`);
    }

    // Apply patches
    for (const liveMatch of relevant) {
      const match = fifaToMatch.get(liveMatch.fifaMatchId);
      if (!match) { skippedCount++; continue; }

      const patch: Partial<typeof wc2026Matches.$inferInsert> = {};
      if (liveMatch.status !== match.status) patch.status = liveMatch.status;
      if (liveMatch.homeScore !== null && liveMatch.homeScore !== match.homeScore) patch.homeScore = liveMatch.homeScore;
      if (liveMatch.awayScore !== null && liveMatch.awayScore !== match.awayScore) patch.awayScore = liveMatch.awayScore;
      if (liveMatch.minute !== match.matchMinute) patch.matchMinute = liveMatch.minute;

      // Auto-set advancingTeamId when FT or FT_PEN
      // Also upgrade status to FT_PEN if penalty scores are present
      if ((liveMatch.status === 'FT' || liveMatch.status === 'FT_PEN') && !match.advancingTeamId) {
        // Case 1: Clear winner from regular/ET score (no pens)
        if (liveMatch.homeScore !== null && liveMatch.awayScore !== null &&
            liveMatch.homeScore !== liveMatch.awayScore &&
            liveMatch.homePenScore === null && liveMatch.awayPenScore === null) {
          patch.advancingTeamId = liveMatch.homeScore > liveMatch.awayScore
            ? match.homeTeamId : match.awayTeamId;
          log('DB', S(), `FT winner (score): ${match.matchId} → advancingTeamId=${patch.advancingTeamId}`);
        }
        // Case 2: Penalty shootout winner via FIFA Winner field
        else if (liveMatch.fifaWinnerId) {
          if (liveMatch.fifaWinnerId === liveMatch.homeTeamFifaId) {
            patch.advancingTeamId = match.homeTeamId;
          } else if (liveMatch.fifaWinnerId === liveMatch.awayTeamFifaId) {
            patch.advancingTeamId = match.awayTeamId;
          }
          // Upgrade status to FT_PEN since penalty shootout was used
          patch.status = 'FT_PEN';
          const penStr = liveMatch.homePenScore !== null
            ? `(${liveMatch.homePenScore}-${liveMatch.awayPenScore} pens)` : '';
          log('DB', S(), `FT_PEN winner (pens) ${penStr}: ${match.matchId} → advancingTeamId=${patch.advancingTeamId??'unknown'}`);
        }
        // Case 3: Penalty shootout winner via penalty scores
        else if (liveMatch.homePenScore !== null && liveMatch.awayPenScore !== null &&
                 liveMatch.homePenScore !== liveMatch.awayPenScore) {
          patch.advancingTeamId = liveMatch.homePenScore > liveMatch.awayPenScore
            ? match.homeTeamId : match.awayTeamId;
          // Upgrade status to FT_PEN since penalty shootout was used
          patch.status = 'FT_PEN';
          log('DB', S(), `FT_PEN winner (pen scores ${liveMatch.homePenScore}-${liveMatch.awayPenScore}): ${match.matchId} → advancingTeamId=${patch.advancingTeamId}`);
        }
      }

      if (Object.keys(patch).length === 0) {
        log('SKIP', S(), `${match.matchId} — no changes`);
        skippedCount++;
        continue;
      }

      log('DB', S(), `UPDATE ${match.matchId}`, JSON.stringify(patch));
      try {
        await db.update(wc2026Matches).set(patch).where(eq(wc2026Matches.matchId, match.matchId));
        log('PASS', S(), `✅ ${match.matchId} updated`);
        updatedCount++;
      } catch (err) {
        const msg = err instanceof Error ? err.message.slice(0,200) : String(err);
        log('FAIL', S(), `❌ UPDATE failed for ${match.matchId}: ${msg}`);
        failCount++;
      }
    }

    const elapsedMs = Date.now() - startMs;
    log('OUTPUT', S(), `Live sync complete in ${elapsedMs}ms`, `updated=${updatedCount} skipped=${skippedCount} fail=${failCount} warn=${warnCount}`);
    res.json({ok:true, updated:updatedCount, skipped:skippedCount, errors:failCount, durationMs:elapsedMs});
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log('FAIL', 'FATAL', `Unhandled exception: ${msg}`);
    notifyOwner({ title: "[HB] fifa-live-sync FATAL", content: msg.slice(0, 500) });
    res.status(500).json({ok:false, error:msg});
  }
}
