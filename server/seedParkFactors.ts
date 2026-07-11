/**
 * seedParkFactors.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Computes 3-year (2024/2025/2026) rolling park run factors for all 30 MLB venues.
 *
 * METHODOLOGY:
 *   1. For each venue, fetch all regular-season (gameType=R) games for each season
 *      via schedule?venueIds=X&hydrate=linescore
 *   2. Sum total runs scored in completed games (both teams combined)
 *   3. Compute avg_rpg_venue = total_runs / games_with_data
 *   4. Compute league_avg_rpg = sum(all venue runs) / sum(all venue games) per season
 *   5. pf_yr = avg_rpg_venue / league_avg_rpg
 *   6. 3yr weighted: pf3yr = (pf2026*w26 + pf2025*w25 + pf2024*w24) / (w26+w25+w24)
 *      Weights: 2026=0.50, 2025=0.30, 2024=0.20 (normalized to available seasons)
 *
 * WEIGHT RATIONALE (50/30/20):
 *   - Park factors are venue-stable year-to-year (Coors doesn't change). A 3-year
 *     sample reduces single-season noise from weather, lineup composition, and
 *     scheduling variance.
 *   - 2026 (50%): Most recent season. Captures any venue modifications, new
 *     fences, humidor changes, or turf/surface changes that affect run scoring.
 *   - 2025 (30%): Full 162-game sample. High statistical reliability. Bridges
 *     recency and stability.
 *   - 2024 (20%): Full 162-game sample. Provides long-run baseline. Weighted
 *     lower than 2025 for recency but meaningfully above zero to prevent
 *     over-fitting to small 2026 early-season samples.
 *   - Normalization: When a season has 0 games (e.g. 2026 pre-season), its
 *     weight is dropped and remaining weights are re-normalized to sum to 1.0.
 *     This ensures the formula is always a proper weighted average.
 *
 * LOGGING FORMAT: [INPUT] [STEP] [STATE] [OUTPUT] [VERIFY]
 */

import { getDb } from './db';
import { mlbParkFactors } from '../drizzle/schema';
import { eq } from 'drizzle-orm';

const MLB_STATS_BASE = 'https://statsapi.mlb.com/api/v1';
const SEASONS = [2024, 2025, 2026] as const;
// Weight scheme: 2026=50%, 2025=30%, 2024=20%
// Rationale: recency-biased but gives meaningful weight to full 162-game seasons.
// Weights are normalized at runtime to available seasons (handles pre-season 2026 = 0 games).
const WEIGHTS = { 2024: 0.20, 2025: 0.30, 2026: 0.50 };

// Minimum home games required before a season's park factor is included in the weighted average.
// Rationale: A park factor computed from fewer than 10 home games has extremely high variance.
// Early-season samples (3-5 games) can produce pf values of 0.40-1.60 purely from random scoring.
// At 10 games, the standard error of the PF estimate drops below ~0.15 (acceptable for weighting).
// Teams below this threshold fall back to prior-year data only (still a valid estimate).
const MIN_GAMES_FOR_PF = 10;

// 30 MLB teams with their 2026 venue IDs
const TEAM_VENUES: Array<{ abbrev: string; teamId: number; venueId: number; venueName: string }> = [
  { abbrev: 'ATH', teamId: 133,  venueId: 2529, venueName: 'Sutter Health Park' },
  { abbrev: 'ATL', teamId: 144,  venueId: 4705, venueName: 'Truist Park' },
  { abbrev: 'ARI', teamId: 109,  venueId: 15,   venueName: 'Chase Field' },
  { abbrev: 'BAL', teamId: 110,  venueId: 2,    venueName: 'Oriole Park at Camden Yards' },
  { abbrev: 'BOS', teamId: 111,  venueId: 3,    venueName: 'Fenway Park' },
  { abbrev: 'CHC', teamId: 112,  venueId: 17,   venueName: 'Wrigley Field' },
  { abbrev: 'CIN', teamId: 113,  venueId: 2602, venueName: 'Great American Ball Park' },
  { abbrev: 'CLE', teamId: 114,  venueId: 5,    venueName: 'Progressive Field' },
  { abbrev: 'COL', teamId: 115,  venueId: 19,   venueName: 'Coors Field' },
  { abbrev: 'CWS', teamId: 145,  venueId: 4,    venueName: 'Rate Field' },
  { abbrev: 'DET', teamId: 116,  venueId: 2394, venueName: 'Comerica Park' },
  { abbrev: 'HOU', teamId: 117,  venueId: 2392, venueName: 'Daikin Park' },
  { abbrev: 'KC',  teamId: 118,  venueId: 7,    venueName: 'Kauffman Stadium' },
  { abbrev: 'LAA', teamId: 108,  venueId: 1,    venueName: 'Angel Stadium' },
  { abbrev: 'LAD', teamId: 119,  venueId: 22,   venueName: 'Dodger Stadium' },
  { abbrev: 'MIA', teamId: 146,  venueId: 4169, venueName: 'loanDepot park' },
  { abbrev: 'MIL', teamId: 158,  venueId: 32,   venueName: 'American Family Field' },
  { abbrev: 'MIN', teamId: 142,  venueId: 3312, venueName: 'Target Field' },
  { abbrev: 'NYM', teamId: 121,  venueId: 3289, venueName: 'Citi Field' },
  { abbrev: 'NYY', teamId: 147,  venueId: 3313, venueName: 'Yankee Stadium' },
  { abbrev: 'PHI', teamId: 143,  venueId: 2681, venueName: 'Citizens Bank Park' },
  { abbrev: 'PIT', teamId: 134,  venueId: 31,   venueName: 'PNC Park' },
  { abbrev: 'SD',  teamId: 135,  venueId: 2680, venueName: 'Petco Park' },
  { abbrev: 'SEA', teamId: 136,  venueId: 680,  venueName: 'T-Mobile Park' },
  { abbrev: 'SF',  teamId: 137,  venueId: 2395, venueName: 'Oracle Park' },
  { abbrev: 'STL', teamId: 138,  venueId: 2889, venueName: 'Busch Stadium' },
  { abbrev: 'TB',  teamId: 139,  venueId: 2523, venueName: 'George M. Steinbrenner Field' },
  { abbrev: 'TEX', teamId: 140,  venueId: 5325, venueName: 'Globe Life Field' },
  { abbrev: 'TOR', teamId: 141,  venueId: 14,   venueName: 'Rogers Centre' },
  { abbrev: 'WSH', teamId: 120,  venueId: 3309, venueName: 'Nationals Park' },
];

interface VenueSeasonData {
  totalRuns: number;
  games: number;
  avgRpg: number;
}

type SeasonKey = 2024 | 2025 | 2026;

async function fetchVenueSeasonData(venueId: number, season: number): Promise<VenueSeasonData> {
  const url = `${MLB_STATS_BASE}/schedule?sportId=1&season=${season}&gameType=R&venueIds=${venueId}&hydrate=linescore`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for venue ${venueId} season ${season}`);
  const data = await resp.json() as any;

  let totalRuns = 0;
  let games = 0;

  for (const date of (data.dates ?? [])) {
    for (const game of (date.games ?? [])) {
      const ls = game.linescore ?? {};
      const awayR = ls.teams?.away?.runs ?? null;
      const homeR = ls.teams?.home?.runs ?? null;
      // Only count final games (codedGameState "F"), excluding in-progress games.
      // Fallback: if status is missing (unexpected shape), keep the old runs-based heuristic.
      const coded = game?.status?.codedGameState;
      const isCompleted = coded !== undefined
        ? coded === 'F' && awayR !== null && homeR !== null
        : awayR !== null && homeR !== null && (awayR > 0 || homeR > 0);
      if (isCompleted) {
        totalRuns += awayR + homeR;
        games++;
      }
    }
  }

  const avgRpg = games > 0 ? totalRuns / games : 0;
  return { totalRuns, games, avgRpg };
}

export async function seedParkFactors(): Promise<{ inserted: number; updated: number; errors: number }> {
  console.log('[INPUT] Starting park factor seeder — 2024/2025/2026 rolling seasons');
  console.log(`[INPUT] Weights: 2026=${WEIGHTS[2026]} 2025=${WEIGHTS[2025]} 2024=${WEIGHTS[2024]}`);
  console.log(`[INPUT] Venues: ${TEAM_VENUES.length} MLB home venues`);

  const db = await getDb();
  const now = Date.now();

  // ── Step 1: Fetch per-venue per-season data ──────────────────────────────
  console.log('\n[STEP] Fetching venue run data for all 30 venues × 3 seasons (2024/2025/2026)...');

  const venueData: Map<number, Record<SeasonKey, VenueSeasonData>> = new Map();
  const leagueData: Record<SeasonKey, { totalRuns: number; totalGames: number }> = {
    2024: { totalRuns: 0, totalGames: 0 },
    2025: { totalRuns: 0, totalGames: 0 },
    2026: { totalRuns: 0, totalGames: 0 },
  };

  for (const tv of TEAM_VENUES) {
    const seasonResults = {} as Record<SeasonKey, VenueSeasonData>;
    for (const season of SEASONS) {
      try {
        const d = await fetchVenueSeasonData(tv.venueId, season);
        seasonResults[season as SeasonKey] = d;
        leagueData[season as SeasonKey].totalRuns += d.totalRuns;
        leagueData[season as SeasonKey].totalGames += d.games;
        console.log(`[STATE] ${tv.abbrev} (${tv.venueName}) ${season}: runs=${d.totalRuns} games=${d.games} avgRpg=${d.avgRpg.toFixed(3)}`);
      } catch (e: any) {
        console.warn(`[STATE] ${tv.abbrev} ${season}: FETCH ERROR — ${e.message}`);
        seasonResults[season as SeasonKey] = { totalRuns: 0, games: 0, avgRpg: 0 };
      }
      // Rate limit: 80ms between requests
      await new Promise((r) => setTimeout(r, 80));
    }
    venueData.set(tv.venueId, seasonResults);
  }

  // ── Step 2: Compute league avg RPG per season ────────────────────────────
  console.log('\n[STEP] Computing league-wide avg RPG per season...');
  const leagueAvgRpg: Record<SeasonKey, number> = {
    2024: leagueData[2024].totalGames > 0 ? leagueData[2024].totalRuns / leagueData[2024].totalGames : 9.0,
    2025: leagueData[2025].totalGames > 0 ? leagueData[2025].totalRuns / leagueData[2025].totalGames : 9.0,
    2026: leagueData[2026].totalGames > 0 ? leagueData[2026].totalRuns / leagueData[2026].totalGames : 9.0,
  };
  for (const season of SEASONS) {
    const s = season as SeasonKey;
    console.log(`[STATE] League ${season}: totalRuns=${leagueData[s].totalRuns} totalGames=${leagueData[s].totalGames} avgRpg=${leagueAvgRpg[s].toFixed(4)}`);
  }

  // ── Step 3: Compute per-venue park factors and upsert ────────────────────
  console.log('\n[STEP] Computing per-venue park factors and upserting...');
  let inserted = 0;
  let updated = 0;
  let errors = 0;

  for (const tv of TEAM_VENUES) {
    const sd = venueData.get(tv.venueId)!;

    // Per-season raw park factors
    const pf2024 = sd[2024].avgRpg > 0 && leagueAvgRpg[2024] > 0 ? sd[2024].avgRpg / leagueAvgRpg[2024] : null;
    const pf2025 = sd[2025].avgRpg > 0 && leagueAvgRpg[2025] > 0 ? sd[2025].avgRpg / leagueAvgRpg[2025] : null;
    const pf2026 = sd[2026].avgRpg > 0 && leagueAvgRpg[2026] > 0 ? sd[2026].avgRpg / leagueAvgRpg[2026] : null;

    // Weighted 3-year park factor (normalize weights to available seasons)
    // 2026 is only included if the team has played at least MIN_GAMES_FOR_PF home games.
    // This prevents small early-season samples from contaminating the weighted average.
    // Example: 3 home games with 0.47 PF would drag a 1.28 Coors down to 0.87 — statistically invalid.
    const games2026 = sd[2026].games;
    const include2026 = pf2026 !== null && games2026 >= MIN_GAMES_FOR_PF;
    const available: Array<{ pf: number; w: number }> = [];
    if (pf2024 !== null) available.push({ pf: pf2024, w: WEIGHTS[2024] });
    if (pf2025 !== null) available.push({ pf: pf2025, w: WEIGHTS[2025] });
    if (include2026)     available.push({ pf: pf2026!, w: WEIGHTS[2026] });

    if (available.length === 0) {
      // No usable season data (all fetches failed or venue has no games) — skip the
      // upsert entirely so an existing good row is never overwritten with neutral 1.0.
      // Consumers already fall back to 1.0 for venues with no row.
      console.warn(`[STATE] ${tv.abbrev}: no usable season data — skipping upsert (existing DB row preserved)`);
      continue;
    }

    const totalWeight = available.reduce((s, x) => s + x.w, 0);
    const parkFactor3yr = available.reduce((s, x) => s + x.pf * (x.w / totalWeight), 0);
    if (!include2026 && pf2026 !== null) {
      console.log(`[STATE] ${tv.abbrev}: pf2026=${pf2026.toFixed(4)} excluded (games2026=${games2026} < MIN_GAMES_FOR_PF=${MIN_GAMES_FOR_PF}) — using prior years only`);
    }

    const leagueAvgDisplay = leagueAvgRpg[2026] > 0 ? leagueAvgRpg[2026] : leagueAvgRpg[2025];

    console.log(`[STATE] ${tv.abbrev}: pf2024=${pf2024?.toFixed(4) ?? 'N/A'} pf2025=${pf2025?.toFixed(4) ?? 'N/A'} pf2026=${pf2026?.toFixed(4) ?? 'N/A'} → 3yr=${parkFactor3yr.toFixed(4)}`);

    // Validate: park factor should be between 0.70 and 1.50
    if (parkFactor3yr < 0.70 || parkFactor3yr > 1.50) {
      console.warn(`[VERIFY] WARN — ${tv.abbrev} parkFactor3yr=${parkFactor3yr.toFixed(4)} outside expected range [0.70, 1.50]`);
    }

    try {
      const existing = await db.select({ id: mlbParkFactors.id })
        .from(mlbParkFactors)
        .where(eq(mlbParkFactors.venueId, tv.venueId))
        .limit(1);

      const row = {
        venueId: tv.venueId,
        venueName: tv.venueName,
        teamAbbrev: tv.abbrev,
        runs2024: sd[2024].totalRuns || null,
        games2024: sd[2024].games || null,
        avgRpg2024: sd[2024].avgRpg > 0 ? sd[2024].avgRpg : null,
        pf2024,
        runs2025: sd[2025].totalRuns || null,
        games2025: sd[2025].games || null,
        avgRpg2025: sd[2025].avgRpg > 0 ? sd[2025].avgRpg : null,
        pf2025,
        runs2026: sd[2026].totalRuns || null,
        games2026: sd[2026].games || null,
        avgRpg2026: sd[2026].avgRpg > 0 ? sd[2026].avgRpg : null,
        pf2026,
        parkFactor3yr,
        leagueAvgRpg: leagueAvgDisplay,
        lastFetchedAt: now,
      };

      if (existing.length > 0) {
        await db.update(mlbParkFactors).set(row).where(eq(mlbParkFactors.venueId, tv.venueId));
        updated++;
      } else {
        await db.insert(mlbParkFactors).values(row);
        inserted++;
      }
    } catch (e: any) {
      console.error(`[ERROR] ${tv.abbrev}: DB upsert failed — ${e.message}`);
      errors++;
    }
  }

  // ── Step 4: Final validation ─────────────────────────────────────────────
  console.log('\n[OUTPUT] Park factor seeder complete');
  console.log(`[OUTPUT] inserted=${inserted} updated=${updated} errors=${errors}`);

  const allRows = await db.select({
    teamAbbrev: mlbParkFactors.teamAbbrev,
    venueName: mlbParkFactors.venueName,
    parkFactor3yr: mlbParkFactors.parkFactor3yr,
    pf2024: mlbParkFactors.pf2024,
    pf2025: mlbParkFactors.pf2025,
    pf2026: mlbParkFactors.pf2026,
  }).from(mlbParkFactors);

  const sorted = [...allRows].sort((a, b) => (b.parkFactor3yr ?? 0) - (a.parkFactor3yr ?? 0));
  console.log('\n[VERIFY] Top 5 hitter-friendly parks:');
  sorted.slice(0, 5).forEach((r: typeof allRows[0]) => {
    console.log(`  ${r.teamAbbrev} (${r.venueName}): 3yr=${r.parkFactor3yr?.toFixed(4)} | 2024=${r.pf2024?.toFixed(4) ?? 'N/A'} 2025=${r.pf2025?.toFixed(4) ?? 'N/A'} 2026=${r.pf2026?.toFixed(4) ?? 'N/A'}`);
  });
  console.log('[VERIFY] Top 5 pitcher-friendly parks:');
  sorted.slice(-5).reverse().forEach((r: typeof allRows[0]) => {
    console.log(`  ${r.teamAbbrev} (${r.venueName}): 3yr=${r.parkFactor3yr?.toFixed(4)} | 2024=${r.pf2024?.toFixed(4) ?? 'N/A'} 2025=${r.pf2025?.toFixed(4) ?? 'N/A'} 2026=${r.pf2026?.toFixed(4) ?? 'N/A'}`);
  });

  // Sanity check: Coors Field should be highest
  const coors = allRows.find((r: any) => r.teamAbbrev === 'COL');
  const coorsRank = sorted.findIndex((r: any) => r.teamAbbrev === 'COL') + 1;
  if (coors && coorsRank <= 3) {
    console.log(`[VERIFY] PASS — Coors Field ranked #${coorsRank} with pf3yr=${coors.parkFactor3yr?.toFixed(4)}`);
  } else {
    console.warn(`[VERIFY] WARN — Coors Field ranked #${coorsRank} (expected top 3), pf3yr=${coors?.parkFactor3yr?.toFixed(4) ?? 'N/A'}`);
  }

  if (errors === 0) {
    console.log(`[VERIFY] PASS — ${inserted + updated} park factors seeded with 0 errors`);
  } else {
    console.error(`[VERIFY] FAIL — ${errors} errors during seeding`);
  }
  return { inserted, updated, errors };
}

// Self-invoke only when run directly (tsx seedParkFactors.ts)
if (process.argv[1]?.endsWith('seedParkFactors.ts') || process.argv[1]?.endsWith('seedParkFactors.js')) {
  seedParkFactors().catch(e => {
    console.error('[ERROR] Fatal:', e.message);
    process.exit(1);
  });
}
