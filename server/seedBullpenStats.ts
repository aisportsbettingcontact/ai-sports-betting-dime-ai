/**
 * seedBullpenStats.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Aggregates 2025 relief pitcher stats for all 30 MLB teams from MLB Stats API.
 *
 * METHODOLOGY:
 *   1. Fetch all pitchers for each team: stats?group=pitching&season=2026&teamId=X
 *   2. Filter relievers: gamesStarted = 0 AND inningsPitched >= 1.0
 *   3. Aggregate across all relievers:
 *      - totalIp, totalEr, totalK, totalBb, totalHr, totalH
 *      - eraBullpen  = (totalEr / totalIp) * 9
 *      - k9Bullpen   = (totalK / totalIp) * 9
 *      - bb9Bullpen  = (totalBb / totalIp) * 9
 *      - hr9Bullpen  = (totalHr / totalIp) * 9
 *      - whipBullpen = (totalH + totalBb) / totalIp
 *      - kBbRatio    = totalK / totalBb
 *      - fipBullpen  = (13*totalHr + 3*totalBb - 2*totalK) / totalIp + 3.10
 *
 * LOGGING FORMAT: [INPUT] [STEP] [STATE] [OUTPUT] [VERIFY]
 */

import { getDb } from './db';
import { mlbBullpenStats } from '../drizzle/schema';
import { and, eq } from 'drizzle-orm';

const MLB_STATS_BASE = 'https://statsapi.mlb.com/api/v1';
const SEASON = 2026;
const FIP_CONSTANT = 3.10;

// 30 MLB teams with their MLB Stats API team IDs
const MLB_TEAMS: Array<{ abbrev: string; teamId: number }> = [
  { abbrev: 'ATH', teamId: 133 },
  { abbrev: 'ATL', teamId: 144 },
  { abbrev: 'ARI', teamId: 109 },
  { abbrev: 'BAL', teamId: 110 },
  { abbrev: 'BOS', teamId: 111 },
  { abbrev: 'CHC', teamId: 112 },
  { abbrev: 'CIN', teamId: 113 },
  { abbrev: 'CLE', teamId: 114 },
  { abbrev: 'COL', teamId: 115 },
  { abbrev: 'CWS', teamId: 145 },
  { abbrev: 'DET', teamId: 116 },
  { abbrev: 'HOU', teamId: 117 },
  { abbrev: 'KC',  teamId: 118 },
  { abbrev: 'LAA', teamId: 108 },
  { abbrev: 'LAD', teamId: 119 },
  { abbrev: 'MIA', teamId: 146 },
  { abbrev: 'MIL', teamId: 158 },
  { abbrev: 'MIN', teamId: 142 },
  { abbrev: 'NYM', teamId: 121 },
  { abbrev: 'NYY', teamId: 147 },
  { abbrev: 'PHI', teamId: 143 },
  { abbrev: 'PIT', teamId: 134 },
  { abbrev: 'SD',  teamId: 135 },
  { abbrev: 'SEA', teamId: 136 },
  { abbrev: 'SF',  teamId: 137 },
  { abbrev: 'STL', teamId: 138 },
  { abbrev: 'TB',  teamId: 139 },
  { abbrev: 'TEX', teamId: 140 },
  { abbrev: 'TOR', teamId: 141 },
  { abbrev: 'WSH', teamId: 120 },
];

/** Parse "6.1" innings string → decimal IP (6.333...) */
function parseIp(ipStr: string | number | null | undefined): number {
  if (!ipStr) return 0;
  const s = String(ipStr);
  const parts = s.split('.');
  const full = parseInt(parts[0] ?? '0', 10);
  const thirds = parseInt(parts[1] ?? '0', 10);
  return full + thirds / 3;
}

export async function seedBullpenStats(): Promise<{ inserted: number; updated: number; errors: number }> {
  console.log('[INPUT] Starting bullpen stats seeder');
  console.log(`[INPUT] Season: ${SEASON} | Teams: ${MLB_TEAMS.length} | Filter: gamesStarted=0 AND ip>=1.0`);

  const db = await getDb();
  const now = Date.now();

  let inserted = 0;
  let updated = 0;
  let errors = 0;

  // League-wide accumulator for validation
  const leagueTotals = { ip: 0, er: 0, k: 0, bb: 0, hr: 0, h: 0, teams: 0 };

  for (const team of MLB_TEAMS) {
    console.log(`\n[STEP] Fetching bullpen for ${team.abbrev} (teamId=${team.teamId})...`);

    try {
      const url = `${MLB_STATS_BASE}/stats?stats=season&group=pitching&gameType=R&season=${SEASON}&teamId=${team.teamId}&sportId=1&playerPool=All&limit=100`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json() as any;

      const allPitchers = data?.stats?.[0]?.splits ?? [];
      console.log(`[STATE] ${team.abbrev}: total pitchers in API response = ${allPitchers.length}`);

      // Filter to relievers: gamesStarted=0 AND ip >= 1.0
      const relievers = allPitchers.filter((p: any) => {
        const gs = parseInt(p.stat?.gamesStarted ?? '0', 10);
        const ip = parseIp(p.stat?.inningsPitched);
        return gs === 0 && ip >= 1.0;
      });

      console.log(`[STATE] ${team.abbrev}: relievers (GS=0, IP>=1) = ${relievers.length}`);

      if (relievers.length === 0) {
        console.warn(`[STATE] ${team.abbrev}: WARN — no qualifying relievers found, skipping`);
        continue;
      }

      // Aggregate
      let totalIp = 0, totalEr = 0, totalK = 0, totalBb = 0, totalHr = 0, totalH = 0;
      for (const p of relievers) {
        const s = p.stat;
        totalIp  += parseIp(s.inningsPitched);
        totalEr  += parseInt(s.earnedRuns ?? '0', 10);
        totalK   += parseInt(s.strikeOuts ?? '0', 10);
        totalBb  += parseInt(s.baseOnBalls ?? '0', 10);
        totalHr  += parseInt(s.homeRuns ?? '0', 10);
        totalH   += parseInt(s.hits ?? '0', 10);
      }

      // Compute derived stats
      const eraBullpen  = totalIp > 0 ? (totalEr / totalIp) * 9 : null;
      const k9Bullpen   = totalIp > 0 ? (totalK / totalIp) * 9 : null;
      const bb9Bullpen  = totalIp > 0 ? (totalBb / totalIp) * 9 : null;
      const hr9Bullpen  = totalIp > 0 ? (totalHr / totalIp) * 9 : null;
      const whipBullpen = totalIp > 0 ? (totalH + totalBb) / totalIp : null;
      const kBbRatio    = totalBb > 0 ? totalK / totalBb : null;
      const fipBullpen  = totalIp > 0
        ? (13 * totalHr + 3 * totalBb - 2 * totalK) / totalIp + FIP_CONSTANT
        : null;

      console.log(`[STATE] ${team.abbrev}: ip=${totalIp.toFixed(1)} er=${totalEr} k=${totalK} bb=${totalBb} hr=${totalHr} h=${totalH}`);
      console.log(`[STATE] ${team.abbrev}: ERA=${eraBullpen?.toFixed(2)} K/9=${k9Bullpen?.toFixed(2)} BB/9=${bb9Bullpen?.toFixed(2)} HR/9=${hr9Bullpen?.toFixed(2)} WHIP=${whipBullpen?.toFixed(3)} K/BB=${kBbRatio?.toFixed(2)} FIP=${fipBullpen?.toFixed(2)}`);

      // Validate ERA range
      if (eraBullpen !== null && (eraBullpen < 0 || eraBullpen > 15)) {
        console.warn(`[VERIFY] WARN — ${team.abbrev} bullpen ERA=${eraBullpen.toFixed(2)} outside expected range [0, 15]`);
      }

      // Accumulate league totals
      leagueTotals.ip += totalIp;
      leagueTotals.er += totalEr;
      leagueTotals.k  += totalK;
      leagueTotals.bb += totalBb;
      leagueTotals.hr += totalHr;
      leagueTotals.h  += totalH;
      leagueTotals.teams++;

      // Upsert
      const existing = await db.select({ id: mlbBullpenStats.id })
        .from(mlbBullpenStats)
        .where(and(eq(mlbBullpenStats.teamAbbrev, team.abbrev), eq(mlbBullpenStats.season, SEASON)))
        .limit(1);

      const row = {
        teamAbbrev: team.abbrev,
        mlbTeamId: team.teamId,
        season: SEASON,
        relieverCount: relievers.length,
        totalIp,
        totalEr,
        totalK,
        totalBb,
        totalHr,
        totalH,
        eraBullpen,
        k9Bullpen,
        bb9Bullpen,
        hr9Bullpen,
        whipBullpen,
        kBbRatio,
        fipBullpen,
        lastFetchedAt: now,
      };

      if (existing.length > 0) {
        await db.update(mlbBullpenStats).set(row).where(and(eq(mlbBullpenStats.teamAbbrev, team.abbrev), eq(mlbBullpenStats.season, SEASON)));
        updated++;
        console.log(`[OUTPUT] ${team.abbrev}: UPDATED`);
      } else {
        await db.insert(mlbBullpenStats).values(row);
        inserted++;
        console.log(`[OUTPUT] ${team.abbrev}: INSERTED`);
      }

    } catch (e: any) {
      console.error(`[ERROR] ${team.abbrev}: ${e.message}`);
      errors++;
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 100));
  }

  // ── Final validation ─────────────────────────────────────────────────────
  console.log('\n[OUTPUT] Bullpen seeder complete');
  console.log(`[OUTPUT] inserted=${inserted} updated=${updated} errors=${errors} teams_processed=${leagueTotals.teams}`);

  // League-wide bullpen ERA
  const leagueEra = leagueTotals.ip > 0 ? (leagueTotals.er / leagueTotals.ip) * 9 : 0;
  const leagueK9  = leagueTotals.ip > 0 ? (leagueTotals.k / leagueTotals.ip) * 9 : 0;
  const leagueBb9 = leagueTotals.ip > 0 ? (leagueTotals.bb / leagueTotals.ip) * 9 : 0;
  console.log(`[VERIFY] League bullpen: ERA=${leagueEra.toFixed(3)} K/9=${leagueK9.toFixed(3)} BB/9=${leagueBb9.toFixed(3)}`);

  // Fetch all rows for ranking
  const allRows = await db.select({
    teamAbbrev: mlbBullpenStats.teamAbbrev,
    eraBullpen: mlbBullpenStats.eraBullpen,
    k9Bullpen: mlbBullpenStats.k9Bullpen,
    fipBullpen: mlbBullpenStats.fipBullpen,
    relieverCount: mlbBullpenStats.relieverCount,
  }).from(mlbBullpenStats).where(eq(mlbBullpenStats.season, SEASON));

  const sorted = [...allRows].sort((a, b) => (a.eraBullpen ?? 99) - (b.eraBullpen ?? 99));
  console.log('\n[VERIFY] Top 5 best bullpens (ERA):');
  sorted.slice(0, 5).forEach((r: any) => {
    console.log(`  ${r.teamAbbrev}: ERA=${r.eraBullpen?.toFixed(2)} K/9=${r.k9Bullpen?.toFixed(2)} FIP=${r.fipBullpen?.toFixed(2)} (${r.relieverCount} relievers)`);
  });
  console.log('[VERIFY] Bottom 5 worst bullpens (ERA):');
  sorted.slice(-5).reverse().forEach((r: any) => {
    console.log(`  ${r.teamAbbrev}: ERA=${r.eraBullpen?.toFixed(2)} K/9=${r.k9Bullpen?.toFixed(2)} FIP=${r.fipBullpen?.toFixed(2)} (${r.relieverCount} relievers)`);
  });

  // Sanity: ERA should be between 2.0 and 8.0 for any team
  const outliers = allRows.filter((r: any) => r.eraBullpen !== null && (r.eraBullpen < 2.0 || r.eraBullpen > 8.0));
  if (outliers.length > 0) {
    console.warn(`[VERIFY] WARN — ${outliers.length} teams with ERA outside [2.0, 8.0]: ${outliers.map((r: any) => r.teamAbbrev).join(', ')}`);
  }

  if (errors === 0) {
    console.log(`[VERIFY] PASS — ${inserted + updated} bullpen rows seeded with 0 errors`);
  } else {
    console.error(`[VERIFY] FAIL — ${errors} errors during seeding`);
  }
  return { inserted, updated, errors };
}

// Self-invoke only when run directly (tsx seedBullpenStats.ts)
if (process.argv[1]?.endsWith('seedBullpenStats.ts') || process.argv[1]?.endsWith('seedBullpenStats.js')) {
  seedBullpenStats().catch(e => {
    console.error('[ERROR] Fatal:', e.message);
    process.exit(1);
  });
}
