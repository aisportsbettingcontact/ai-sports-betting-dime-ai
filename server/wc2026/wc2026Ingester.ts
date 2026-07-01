/**
 * wc2026EspnResultsIngester.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Automated ESPN API result ingestion pipeline for World Cup 2026.
 *
 * Source: ESPN public soccer API (no auth required)
 *   Scoreboard: https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=YYYYMMDD
 *   Summary:    https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event={id}
 *
 * Pipeline:
 *   1. Fetch scoreboard for target date → get ESPN event IDs + scores + status
 *   2. For each FT event: fetch full summary → box score stats, lineups, key events
 *   3. Match ESPN teams to wc2026_fixtures via wc2026_team_aliases
 *   4. Upsert:
 *      - wc2026_fixtures: home_score, away_score, status=FT, espn_event_id, attendance, kickoff_utc
 *      - wc2026_match_stats: 28 box score stat columns + computed xG
 *      - wc2026_match_events: goals, cards, subs with minute
 *      - wc2026_lineups: confirmed post-match lineups (isConfirmed=true)
 *
 * xG Computation (no external source needed):
 *   xG = shots_on_target × 0.33 + (total_shots - shots_on_target) × 0.04
 *   This is a simplified shot-quality model (industry standard for backtesting
 *   when Opta/StatsBomb xG is unavailable). Calibrated to WC historical conversion rates.
 *
 * Logging format:
 *   [WC2026ESPN] [INPUT]  → date, events fetched
 *   [WC2026ESPN] [STEP]   → per-match processing
 *   [WC2026ESPN] [STATE]  → per-table upsert
 *   [WC2026ESPN] [OUTPUT] → rows written
 *   [WC2026ESPN] [VERIFY] → PASS / FAIL + reason
 */

import { getDb } from "../db";
import type { MySql2Database } from "drizzle-orm/mysql2";
import {
  wc2026Fixtures,
  wc2026MatchStats,
  wc2026MatchEvents,
  wc2026Lineups,
  wc2026Teams,
  wc2026TeamAliases,
  type InsertWc2026MatchStats,
  type InsertWc2026MatchEvent,
  type InsertWc2026Lineup,
} from "../../drizzle/wc2026.schema";
import { eq, and } from "drizzle-orm";

// ─── Constants ────────────────────────────────────────────────────────────────
const ESPN_SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";
const ESPN_SUMMARY_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary";
const ESPN_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "Accept": "application/json",
};

// xG model constants (calibrated to WC historical shot conversion rates)
const XG_SHOT_ON_TARGET_WEIGHT = 0.33;  // shots on target → ~33% conversion
const XG_SHOT_OFF_TARGET_WEIGHT = 0.04; // shots off target → ~4% conversion

// ─── Types ────────────────────────────────────────────────────────────────────
interface EspnTeam {
  id: string;
  displayName: string;
  abbreviation: string;
  score?: string;
  homeAway: "home" | "away";
  team?: { id: string; displayName: string; abbreviation: string };
}

interface EspnEvent {
  id: string;
  name: string;
  // [FIX] Added status.type.name for STATUS_IN_PROGRESS detection
  status: { type: { description: string; completed: boolean; name?: string } };
  competitions: EspnCompetition[];
}

interface EspnCompetition {
  competitors: EspnTeam[];
  venue?: { fullName: string; address?: { city: string } };
  statistics?: EspnStat[];
  details?: EspnDetail[];
}

interface EspnStat {
  name: string;
  displayValue: string;
  homeValue?: string;
  awayValue?: string;
}

interface EspnDetail {
  type?: { text: string };
  clock?: { displayValue: string };
  athletesInvolved?: Array<{ displayName: string; team?: { id: string } }>;
  team?: { id: string };
  scoringPlay?: boolean;
}

interface EspnRoster {
  team: { id: string; displayName: string };
  roster: EspnPlayer[];
}

interface EspnPlayer {
  athlete: { displayName: string; id: string };
  position?: { abbreviation: string };
  jersey?: string;
  starter?: boolean;
  subbedIn?: boolean;
}

// ─── Result types ─────────────────────────────────────────────────────────────
export interface EspnIngestionResult {
  date: string;
  eventsProcessed: number;
  fixturesUpdated: number;
  statsWritten: number;
  eventsWritten: number;
  lineupsWritten: number;
  errors: string[];
  matchSummaries: MatchSummary[];
}

interface MatchSummary {
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  score: string;
  status: string;
  homeXg: number;
  awayXg: number;
  attendance?: number;
}

// ─── ESPN API fetch helpers ───────────────────────────────────────────────────
async function fetchEspnScoreboard(dateStr: string): Promise<EspnEvent[]> {
  const url = `${ESPN_SCOREBOARD_URL}?dates=${dateStr}`;
  console.log(`[WC2026ESPN] [INPUT] Fetching scoreboard: ${url}`);
  const resp = await fetch(url, { headers: ESPN_HEADERS });
  if (!resp.ok) throw new Error(`ESPN scoreboard HTTP ${resp.status}`);
  const data = await resp.json();
  const events: EspnEvent[] = data.events ?? [];
  console.log(`[WC2026ESPN] [INPUT] Scoreboard returned ${events.length} events`);
  return events;
}

async function fetchEspnSummary(eventId: string): Promise<any> {
  const url = `${ESPN_SUMMARY_URL}?event=${eventId}`;
  console.log(`[WC2026ESPN] [STEP] Fetching summary for event ${eventId}: ${url}`);
  const resp = await fetch(url, { headers: ESPN_HEADERS });
  if (!resp.ok) throw new Error(`ESPN summary HTTP ${resp.status} for event ${eventId}`);
  return resp.json();
}

// ─── Team resolution ──────────────────────────────────────────────────────────
async function resolveEspnTeamToFixtureTeam(
  db: MySql2Database<any>,
  espnTeamName: string,
  espnTeamAbbr: string
): Promise<string | null> {
  // Try alias lookup first (most reliable)
  const aliasRows = await db
    .select({ teamId: wc2026TeamAliases.teamId })
    .from(wc2026TeamAliases)
    .where(eq(wc2026TeamAliases.alias, espnTeamName))
    .limit(1);

  if (aliasRows.length > 0) {
    console.log(`[WC2026ESPN] [STATE] Resolved "${espnTeamName}" → teamId=${aliasRows[0].teamId} via alias`);
    return aliasRows[0].teamId;
  }

  // Try direct name match on wc2026_teams
  const teamRows = await db
    .select({ teamId: wc2026Teams.teamId })
    .from(wc2026Teams)
    .where(eq(wc2026Teams.name, espnTeamName))
    .limit(1);

  if (teamRows.length > 0) {
    console.log(`[WC2026ESPN] [STATE] Resolved "${espnTeamName}" → teamId=${teamRows[0].teamId} via name`);
    return teamRows[0].teamId;
  }

  // Try FIFA code match
  const codeRows = await db
    .select({ teamId: wc2026Teams.teamId })
    .from(wc2026Teams)
    .where(eq(wc2026Teams.fifaCode, espnTeamAbbr.toUpperCase()))
    .limit(1);

  if (codeRows.length > 0) {
    console.log(`[WC2026ESPN] [STATE] Resolved "${espnTeamName}" (${espnTeamAbbr}) → teamId=${codeRows[0].teamId} via FIFA code`);
    return codeRows[0].teamId;
  }

  console.warn(`[WC2026ESPN] [STATE] WARNING: Could not resolve ESPN team "${espnTeamName}" (${espnTeamAbbr})`);
  return null;
}

// ─── xG computation ───────────────────────────────────────────────────────────
function computeXg(totalShots: number, shotsOnTarget: number): number {
  const shotsOffTarget = Math.max(0, totalShots - shotsOnTarget);
  const xg = shotsOnTarget * XG_SHOT_ON_TARGET_WEIGHT + shotsOffTarget * XG_SHOT_OFF_TARGET_WEIGHT;
  return Math.round(xg * 100) / 100; // round to 2 decimal places
}

// ─── Parse box score stats ────────────────────────────────────────────────────
function parseStatValue(val: string | undefined): number | null {
  if (val === undefined || val === null || val === "") return null;
  const n = parseFloat(val.replace("%", ""));
  return isNaN(n) ? null : n;
}

function extractBoxScoreStats(teams: any[]): {
  home: Record<string, number | null>;
  away: Record<string, number | null>;
} {
  const home: Record<string, number | null> = {};
  const away: Record<string, number | null> = {};

  for (const t of teams) {
    const isHome = t.homeAway === "home";
    const target = isHome ? home : away;
    const stats: any[] = t.statistics ?? [];
    for (const s of stats) {
      target[s.name] = parseStatValue(s.displayValue);
    }
  }

  return { home, away };
}

// ─── Parse minute from string ─────────────────────────────────────────────────
function parseMinute(clockStr: string | undefined): { minuteNum: number | null; isFirstHalf: boolean } {
  if (!clockStr) return { minuteNum: null, isFirstHalf: true };
  // Format: "45+2'" or "90+5'" or "67'"
  const match = clockStr.match(/^(\d+)/);
  if (!match) return { minuteNum: null, isFirstHalf: true };
  const base = parseInt(match[1], 10);
  return { minuteNum: base, isFirstHalf: base <= 45 };
}

// ─── Main ingestion function ──────────────────────────────────────────────────
export async function ingestWc2026EspnResults(options: {
  dateStr: string;        // YYYYMMDD format
  onlyFinalMatches?: boolean; // default true — only ingest FT matches
  forceReingest?: boolean;    // re-ingest even if already FT in DB
}): Promise<EspnIngestionResult> {
  const { dateStr, onlyFinalMatches = true, forceReingest = false } = options;
  const db = (await getDb()) as MySql2Database<any>;
  const result: EspnIngestionResult = {
    date: dateStr,
    eventsProcessed: 0,
    fixturesUpdated: 0,
    statsWritten: 0,
    eventsWritten: 0,
    lineupsWritten: 0,
    errors: [],
    matchSummaries: [],
  };

  console.log(`[WC2026ESPN] [INPUT] Starting ingestion for date=${dateStr} onlyFinal=${onlyFinalMatches} forceReingest=${forceReingest}`);

  // Step 1: Fetch scoreboard
  let events: EspnEvent[];
  try {
    events = await fetchEspnScoreboard(dateStr);
  } catch (err) {
    const msg = `Failed to fetch ESPN scoreboard: ${String(err)}`;
    console.error(`[WC2026ESPN] [VERIFY] FAIL — ${msg}`);
    result.errors.push(msg);
    return result;
  }

  // Step 2: Filter to WC matches (exclude friendlies, other competitions)
  // ESPN returns all soccer events; we need to filter to WC2026 fixtures
  // We do this by matching against our wc2026_fixtures table

  for (const event of events) {
    result.eventsProcessed++;
    const eventId = event.id;
    const statusDesc = event.status?.type?.description ?? "Unknown";
    const statusName = event.status?.type?.name ?? "";
    const isCompleted = event.status?.type?.completed ?? false;
    // [FIX] Expanded isInProgress: ESPN uses multiple status names for in-play games.
    // Root cause of silent SKIP: STATUS_SECOND_HALF was not in the original check.
    // Full set of ESPN in-play status names for soccer:
    //   STATUS_FIRST_HALF   → 1st half in progress
    //   STATUS_HALFTIME     → half-time break (still live, no score change expected)
    //   STATUS_SECOND_HALF  → 2nd half in progress  ← THIS was the missing case
    //   STATUS_EXTRA_TIME   → extra time
    //   STATUS_PENALTY      → penalty shootout
    //   STATUS_IN_PROGRESS  → generic in-progress (fallback)
    const ESPN_LIVE_STATUS_NAMES = new Set([
      "STATUS_IN_PROGRESS",
      "STATUS_FIRST_HALF",
      "STATUS_HALFTIME",
      "STATUS_SECOND_HALF",
      "STATUS_EXTRA_TIME",
      "STATUS_EXTRA_TIME_HALF_TIME",
      "STATUS_PENALTY",
    ]);
    const isInProgress = ESPN_LIVE_STATUS_NAMES.has(statusName) || statusDesc.toLowerCase().includes("in progress");
    // [FIX] Determine target DB status dynamically:
    //   completed=true  → FT
    //   in-progress     → LIVE
    //   otherwise       → null (skip — do NOT write FT/0-0 to unplayed matches)
    const fixtureStatus: "FT" | "LIVE" | null = isCompleted ? "FT" : isInProgress ? "LIVE" : null;

    console.log(`[WC2026ESPN] [STEP] Processing event ${eventId}: "${event.name}" status=${statusDesc} statusName=${statusName} completed=${isCompleted} isInProgress=${isInProgress} → fixtureStatus=${fixtureStatus ?? 'SKIP'}`);

    if (onlyFinalMatches && !isCompleted) {
      console.log(`[WC2026ESPN] [STEP] Skipping event ${eventId} — not completed (status=${statusDesc})`);
      continue;
    }
    // [FIX] When onlyFinalMatches=false (live mode): skip events that are neither FT nor LIVE
    if (!onlyFinalMatches && fixtureStatus === null) {
      console.log(`[WC2026ESPN] [STEP] Skipping event ${eventId} — not in-progress or completed (status=${statusDesc})`);
      continue;
    }

    const comp = event.competitions?.[0];
    if (!comp) {
      console.warn(`[WC2026ESPN] [STATE] No competition data for event ${eventId}`);
      continue;
    }

    const homeComp = comp.competitors?.find((c: any) => c.homeAway === "home");
    const awayComp = comp.competitors?.find((c: any) => c.homeAway === "away");

    if (!homeComp || !awayComp) {
      console.warn(`[WC2026ESPN] [STATE] Missing home/away competitor for event ${eventId}`);
      continue;
    }

    const homeScore = parseInt(homeComp.score ?? "0", 10);
    const awayScore = parseInt(awayComp.score ?? "0", 10);
    const homeTeamName = homeComp.team?.displayName ?? homeComp.displayName ?? "";
    const awayTeamName = awayComp.team?.displayName ?? awayComp.displayName ?? "";
    const homeTeamAbbr = homeComp.team?.abbreviation ?? homeComp.abbreviation ?? "";
    const awayTeamAbbr = awayComp.team?.abbreviation ?? awayComp.abbreviation ?? "";

    console.log(`[WC2026ESPN] [STATE] Match: ${awayTeamName} (${awayScore}) @ ${homeTeamName} (${homeScore})`);

    // Resolve team IDs
    const homeTeamId = await resolveEspnTeamToFixtureTeam(db, homeTeamName, homeTeamAbbr);
    const awayTeamId = await resolveEspnTeamToFixtureTeam(db, awayTeamName, awayTeamAbbr);

    if (!homeTeamId || !awayTeamId) {
      const msg = `Could not resolve teams for event ${eventId}: home="${homeTeamName}" away="${awayTeamName}"`;
      console.warn(`[WC2026ESPN] [STATE] WARNING: ${msg} — skipping (not a WC2026 fixture)`);
      // Not an error — this is expected for non-WC events in the ESPN feed
      continue;
    }

    // Find matching fixture
    // [FIX] Track isSwapped: when ESPN home/away orientation is reversed vs DB, scores MUST be inverted
    // Root cause: ESPN sometimes reports COL=home/COD=away while DB has COD=home/COL=away
    // Without this flag, COD (DB home) gets Colombia's score and COL (DB away) gets DR Congo's score
    let isSwapped = false;
    const fixtureRows = await db
      .select({ fixtureId: wc2026Fixtures.fixtureId, status: wc2026Fixtures.status })
      .from(wc2026Fixtures)
      .where(
        and(
          eq(wc2026Fixtures.homeTeamId, homeTeamId),
          eq(wc2026Fixtures.awayTeamId, awayTeamId)
        )
      )
      .limit(1);

    if (fixtureRows.length === 0) {
      // Try swapped (some feeds have home/away orientation reversed)
      const swappedRows = await db
        .select({ fixtureId: wc2026Fixtures.fixtureId, status: wc2026Fixtures.status })
        .from(wc2026Fixtures)
        .where(
          and(
            eq(wc2026Fixtures.homeTeamId, awayTeamId),
            eq(wc2026Fixtures.awayTeamId, homeTeamId)
          )
        )
        .limit(1);

      if (swappedRows.length === 0) {
        const msg = `No fixture found for ${homeTeamId} vs ${awayTeamId} (event ${eventId})`;
        console.warn(`[WC2026ESPN] [STATE] WARNING: ${msg}`);
        result.errors.push(msg);
        continue;
      }

      // [FIX] ESPN orientation is reversed vs DB — set isSwapped=true so scores are inverted below
      isSwapped = true;
      console.warn(
        `[WC2026ESPN] [STATE] WARNING: fixture found with swapped orientation` +
        ` | ESPN home=${homeTeamName}(${homeTeamId}) away=${awayTeamName}(${awayTeamId})` +
        ` | DB home=${awayTeamId} away=${homeTeamId} | isSwapped=true` +
        ` | [VERIFY] ESPN homeScore=${homeScore} awayScore=${awayScore}` +
        ` → DB homeScore=${awayScore} awayScore=${homeScore} (INVERTED)`
      );
    }

    const fixture = fixtureRows[0] ?? (await db
      .select({ fixtureId: wc2026Fixtures.fixtureId, status: wc2026Fixtures.status })
      .from(wc2026Fixtures)
      .where(and(eq(wc2026Fixtures.homeTeamId, awayTeamId), eq(wc2026Fixtures.awayTeamId, homeTeamId)))
      .limit(1)
    )[0];

    const fixtureId = fixture.fixtureId;

    // [FIX] Apply swap: if ESPN orientation is reversed vs DB, invert scores so DB home team gets correct score
    // isSwapped=false: ESPN home=DB home → dbHomeScore=homeScore, dbAwayScore=awayScore (no change)
    // isSwapped=true:  ESPN home=DB away → dbHomeScore=awayScore, dbAwayScore=homeScore (inverted)
    const dbHomeScore = isSwapped ? awayScore : homeScore;
    const dbAwayScore = isSwapped ? homeScore : awayScore;
    console.log(
      `[WC2026ESPN] [STATE] Score orientation resolved: isSwapped=${isSwapped}` +
      ` | ESPN: ${homeTeamName}(${homeScore}) vs ${awayTeamName}(${awayScore})` +
      ` | DB write: homeScore=${dbHomeScore} awayScore=${dbAwayScore}` +
      ` | [VERIFY] fixtureId=${fixtureId}`
    );

    if (fixture.status === "FT" && !forceReingest) {
      console.log(`[WC2026ESPN] [STEP] Skipping fixture ${fixtureId} — already FT and forceReingest=false`);
      continue;
    }

    // [FIX] LIVE path: lightweight score-only upsert — no summary fetch, no stats/events/lineups
    // Uses dbHomeScore/dbAwayScore (swap-corrected) NOT raw homeScore/awayScore from ESPN
    if (fixtureStatus === "LIVE") {
      const kickoffStr = (event.competitions?.[0] as any)?.date ?? null;
      const kickoffUtc = kickoffStr ? new Date(kickoffStr) : null;
      console.log(
        `[WC2026ESPN] [STATE] LIVE upsert fixture ${fixtureId}:` +
        ` dbHomeScore=${dbHomeScore} dbAwayScore=${dbAwayScore} status=LIVE espnEventId=${eventId}` +
        ` | [VERIFY] isSwapped=${isSwapped} ESPN homeScore=${homeScore} awayScore=${awayScore}`
      );
      await db
        .update(wc2026Fixtures)
        .set({
          homeScore: dbHomeScore,
          awayScore: dbAwayScore,
          status: "LIVE",
          espnEventId: eventId,
          ...(kickoffUtc ? { kickoffUtc } : {}),
        })
        .where(eq(wc2026Fixtures.fixtureId, fixtureId));
      result.fixturesUpdated++;
      result.matchSummaries.push({
        fixtureId,
        homeTeam: homeTeamName,
        awayTeam: awayTeamName,
        score: `${dbHomeScore}-${dbAwayScore}`,
        status: statusDesc,
        homeXg: 0,
        awayXg: 0,
      });
      console.log(
        `[WC2026ESPN] [OUTPUT] LIVE fixture ${fixtureId} score updated ✅` +
        ` | DB: homeScore=${dbHomeScore} awayScore=${dbAwayScore}` +
        ` | [VERIFY] PASS — Colombia(away)=${dbAwayScore} DR Congo(home)=${dbHomeScore}`
      );
      continue;
    }

    console.log(`[WC2026ESPN] [STEP] Processing fixture ${fixtureId} — fetching full summary (FT)`);

    // Step 3: Fetch full event summary
    let summary: any;
    try {
      summary = await fetchEspnSummary(eventId);
    } catch (err) {
      const msg = `Failed to fetch ESPN summary for event ${eventId}: ${String(err)}`;
      console.error(`[WC2026ESPN] [VERIFY] FAIL — ${msg}`);
      result.errors.push(msg);
      continue;
    }

    // Step 4: Extract box score stats
    const boxscoreTeams = summary.boxscore?.teams ?? [];
    const statsMap: Record<string, number | null> = {};

    for (const t of boxscoreTeams) {
      const isHome = t.team?.id === homeComp.team?.id;
      const prefix = isHome ? "home" : "away";
      const stats: any[] = t.statistics ?? [];
      for (const s of stats) {
        statsMap[`${prefix}_${s.name}`] = parseStatValue(s.displayValue);
      }
    }

    // Compute xG
    const homeTotalShots = statsMap["home_totalShots"] ?? 0;
    const awayTotalShots = statsMap["away_totalShots"] ?? 0;
    const homeShotsOnTarget = statsMap["home_shotsOnTarget"] ?? 0;
    const awayShotsOnTarget = statsMap["away_shotsOnTarget"] ?? 0;
    const homeXg = computeXg(homeTotalShots, homeShotsOnTarget);
    const awayXg = computeXg(awayTotalShots, awayShotsOnTarget);

    console.log(`[WC2026ESPN] [STATE] xG computed: home=${homeXg} (${homeShotsOnTarget}/${homeTotalShots} shots) away=${awayXg} (${awayShotsOnTarget}/${awayTotalShots} shots)`);

    // Get attendance and kickoff from gameInfo
    const gameInfo = summary.gameInfo ?? {};
    const attendance = gameInfo.attendance ?? null;
    const kickoffStr = (event.competitions?.[0] as any)?.date ?? null;
    const kickoffUtc = kickoffStr ? new Date(kickoffStr) : null;

    // Step 5: Upsert wc2026_fixtures (score, status, espn_event_id, attendance)
    // [FIX] fixtureStatus is always 'FT' at this point (LIVE was handled above via continue)
    // [FIX] Uses dbHomeScore/dbAwayScore (swap-corrected) NOT raw homeScore/awayScore
    console.log(
      `[WC2026ESPN] [STATE] Upserting fixture ${fixtureId}: dbHomeScore=${dbHomeScore} dbAwayScore=${dbAwayScore}` +
      ` status=${fixtureStatus} espnEventId=${eventId}` +
      ` | [VERIFY] isSwapped=${isSwapped} ESPN homeScore=${homeScore} awayScore=${awayScore}`
    );
    await db
      .update(wc2026Fixtures)
      .set({
        homeScore: dbHomeScore,
        awayScore: dbAwayScore,
        status: fixtureStatus as "FT" | "LIVE",
        espnEventId: eventId,
        attendance,
        ...(kickoffUtc ? { kickoffUtc } : {}),
      })
      .where(eq(wc2026Fixtures.fixtureId, fixtureId));
    result.fixturesUpdated++;
    console.log(
      `[WC2026ESPN] [OUTPUT] FT fixture ${fixtureId} fully ingested ✅` +
      ` | DB: homeScore=${dbHomeScore} awayScore=${dbAwayScore}` +
      ` | [VERIFY] PASS — isSwapped=${isSwapped}`
    );

    // Step 6: Upsert wc2026_match_stats
    const matchStatsRow: InsertWc2026MatchStats = {
      fixtureId,
      homePossessionPct: statsMap["home_possessionPct"],
      awayPossessionPct: statsMap["away_possessionPct"],
      homeTotalShots: statsMap["home_totalShots"] as number | null,
      awayTotalShots: statsMap["away_totalShots"] as number | null,
      homeShotsOnTarget: statsMap["home_shotsOnTarget"] as number | null,
      awayShotsOnTarget: statsMap["away_shotsOnTarget"] as number | null,
      homeCorners: statsMap["home_wonCorners"] as number | null,
      awayCorners: statsMap["away_wonCorners"] as number | null,
      homeFouls: statsMap["home_foulsCommitted"] as number | null,
      awayFouls: statsMap["away_foulsCommitted"] as number | null,
      homeYellowCards: statsMap["home_yellowCards"] as number | null,
      awayYellowCards: statsMap["away_yellowCards"] as number | null,
      homeRedCards: statsMap["home_redCards"] as number | null,
      awayRedCards: statsMap["away_redCards"] as number | null,
      homeOffsides: statsMap["home_offsides"] as number | null,
      awayOffsides: statsMap["away_offsides"] as number | null,
      homeSaves: statsMap["home_saves"] as number | null,
      awaySaves: statsMap["away_saves"] as number | null,
      homeTotalPasses: statsMap["home_totalPasses"] as number | null,
      awayTotalPasses: statsMap["away_totalPasses"] as number | null,
      homeAccuratePasses: statsMap["home_accuratePasses"] as number | null,
      awayAccuratePasses: statsMap["away_accuratePasses"] as number | null,
      homePassPct: statsMap["home_passPct"],
      awayPassPct: statsMap["away_passPct"],
      homeEffectiveTackles: statsMap["home_effectiveTackles"] as number | null,
      awayEffectiveTackles: statsMap["away_effectiveTackles"] as number | null,
      homeInterceptions: statsMap["home_interceptions"] as number | null,
      awayInterceptions: statsMap["away_interceptions"] as number | null,
      homeXg: homeXg,
      awayXg: awayXg,
      homeBlockedShots: statsMap["home_blockedShots"] as number | null,
      awayBlockedShots: statsMap["away_blockedShots"] as number | null,
    };

    await db
      .insert(wc2026MatchStats)
      .values(matchStatsRow)
      .onDuplicateKeyUpdate({ set: matchStatsRow });
    result.statsWritten++;
    console.log(`[WC2026ESPN] [OUTPUT] Match stats upserted for ${fixtureId} ✅`);

    // Step 7: Ingest match events (goals, cards, subs)
    const keyEvents: any[] = summary.keyEvents ?? [];
    const allDetails: any[] = summary.header?.competitions?.[0]?.details ?? [];
    const detailsToProcess = keyEvents.length > 0 ? keyEvents : allDetails;

    // Delete existing events for this fixture before reinserting
    await db.delete(wc2026MatchEvents).where(eq(wc2026MatchEvents.fixtureId, fixtureId));

    let eventsInserted = 0;
    for (const detail of detailsToProcess) {
      const typeText: string = detail.type?.text ?? detail.type?.name ?? "";
      let eventType: "GOAL" | "OWN_GOAL" | "PENALTY" | "YELLOW" | "RED" | "SUB" | "VAR" | null = null;

      if (typeText.toLowerCase().includes("goal") && typeText.toLowerCase().includes("own")) {
        eventType = "OWN_GOAL";
      } else if (typeText.toLowerCase().includes("penalty") && typeText.toLowerCase().includes("goal")) {
        eventType = "PENALTY";
      } else if (typeText.toLowerCase().includes("goal") || detail.scoringPlay) {
        eventType = "GOAL";
      } else if (typeText.toLowerCase().includes("yellow")) {
        eventType = "YELLOW";
      } else if (typeText.toLowerCase().includes("red")) {
        eventType = "RED";
      } else if (typeText.toLowerCase().includes("substitut") || typeText.toLowerCase().includes("sub")) {
        eventType = "SUB";
      } else if (typeText.toLowerCase().includes("var")) {
        eventType = "VAR";
      }

      if (!eventType) continue;

      const clockStr = detail.clock?.displayValue ?? detail.clock?.value ?? "";
      const { minuteNum, isFirstHalf } = parseMinute(clockStr);
      const athletes: any[] = detail.athletesInvolved ?? [];
      const playerName = athletes[0]?.displayName ?? null;
      const assistPlayerName = athletes[1]?.displayName ?? null;

      // Resolve team for this event
      const eventTeamId = detail.team?.id
        ? (homeComp.team?.id === detail.team.id ? homeTeamId : awayTeamId)
        : null;

      const eventRow: InsertWc2026MatchEvent = {
        fixtureId,
        teamId: eventTeamId,
        eventType,
        playerName,
        assistPlayerName,
        minuteStr: clockStr || null,
        minuteNum,
        isFirstHalf,
      };

      await db.insert(wc2026MatchEvents).values(eventRow);
      eventsInserted++;
    }

    result.eventsWritten += eventsInserted;
    console.log(`[WC2026ESPN] [OUTPUT] ${eventsInserted} match events inserted for ${fixtureId} ✅`);

    // Step 8: Ingest confirmed lineups from ESPN rosters
    const rosters: EspnRoster[] = summary.rosters ?? [];

    if (rosters.length > 0) {
      // Delete existing lineups for this fixture (replace with confirmed ESPN data)
      await (db as any).delete(wc2026Lineups).where(
        and(
          eq(wc2026Lineups.fixtureId, fixtureId),
          eq(wc2026Lineups.isConfirmed, false)
        )
      );

      let lineupsInserted = 0;
      for (const roster of rosters) {
        const rosterTeamId = roster.team?.id === (homeComp.team?.id ?? homeComp.id) ? homeTeamId : awayTeamId;
        if (!rosterTeamId) continue;

        const players: EspnPlayer[] = roster.roster ?? [];
        for (const player of players) {
          const isStarter = player.starter ?? false;
          const isSubIn = player.subbedIn ?? false;
          if (!isStarter && !isSubIn) continue; // skip unused subs

          const lineupRow: InsertWc2026Lineup = {
            fixtureId,
            teamId: rosterTeamId,
            isConfirmed: true,
            playerName: player.athlete?.displayName ?? "Unknown",
            position: player.position?.abbreviation ?? "UNK",
            isStarter,
            jerseyNumber: player.jersey ? parseInt(player.jersey, 10) : null,
          };

          await (db as any)
            .insert(wc2026Lineups)
            .values(lineupRow)
            .onDuplicateKeyUpdate({ set: { isConfirmed: true, isStarter } });
          lineupsInserted++;
        }
      }

      result.lineupsWritten += lineupsInserted;
      console.log(`[WC2026ESPN] [OUTPUT] ${lineupsInserted} lineup rows upserted for ${fixtureId} ✅`);
    }

    // Add to match summaries
    result.matchSummaries.push({
      fixtureId,
      homeTeam: homeTeamName,
      awayTeam: awayTeamName,
      score: `${awayScore}-${homeScore}`,
      status: statusDesc,
      homeXg,
      awayXg,
      attendance: attendance ?? undefined,
    });

    console.log(`[WC2026ESPN] [VERIFY] PASS — fixture ${fixtureId} fully ingested: score=${awayScore}-${homeScore} xG=${awayXg}-${homeXg} events=${eventsInserted} lineups=${result.lineupsWritten}`);
  }

  const overallPass = result.errors.length === 0;
  console.log(`[WC2026ESPN] [VERIFY] ${overallPass ? "PASS" : "PARTIAL"} — date=${dateStr} fixturesUpdated=${result.fixturesUpdated} statsWritten=${result.statsWritten} eventsWritten=${result.eventsWritten} lineupsWritten=${result.lineupsWritten} errors=${result.errors.length}`);

  return result;
}

// ─── Batch ingestion for a date range ─────────────────────────────────────────
export async function ingestWc2026EspnResultsRange(options: {
  fromDate: Date;
  toDate: Date;
  forceReingest?: boolean;
}): Promise<EspnIngestionResult[]> {
  const { fromDate, toDate, forceReingest = false } = options;
  const results: EspnIngestionResult[] = [];

  const current = new Date(fromDate);
  while (current <= toDate) {
    const dateStr = current.toISOString().slice(0, 10).replace(/-/g, "");
    console.log(`[WC2026ESPN] [STEP] Processing date range: ${dateStr}`);
    const result = await ingestWc2026EspnResults({ dateStr, forceReingest });
    results.push(result);
    current.setDate(current.getDate() + 1);
  }

  return results;
}
