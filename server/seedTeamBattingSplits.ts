/**
 * seedTeamBattingSplits.ts
 *
 * Fetches 2026 team batting splits (vs LHP and vs RHP) for all 30 MLB teams
 * and upserts them into the mlb_team_batting_splits table.
 *
 * Data source:
 *   GET /api/v1/teams/{teamId}/stats?stats=statSplits&group=hitting&season=2026&sitCodes=vl,vr
 *   sitCode 'vl' = vs Left-Handed Pitchers
 *   sitCode 'vr' = vs Right-Handed Pitchers
 *
 * Derived metrics computed here (not from API):
 *   hr9  = HR / AB * 27   (home runs per 9 innings equivalent)
 *   bb9  = BB / AB * 27   (walks per 9 innings equivalent)
 *   k9   = K  / AB * 27   (strikeouts per 9 innings equivalent)
 *   woba = (0.69*BB + 0.888*1B + 1.271*2B + 1.616*3B + 2.101*HR) / (AB + BB)
 *          Note: 1B = H - 2B - 3B - HR (singles)
 *          wOBA weights (2026 linear weights)
 *
 * Execution model:
 *   - Fetches all 30 teams in parallel (concurrency=10)
 *   - Each team gets 2 rows (vl + vr)
 *   - Upserts on (teamAbbrev, hand) unique key
 *   - Full structured logging at every stage
 *
 * Usage:
 *   npx tsx server/seedTeamBattingSplits.ts
 */

import { eq, and } from "drizzle-orm";
import { getDb } from "./db";
import { mlbTeamBattingSplits } from "../drizzle/schema";

// ─── MLB Team Registry ────────────────────────────────────────────────────────
// Maps MLB Stats API team ID → engine abbreviation
// Note: API uses 'AZ' for Arizona but engine uses 'ARI'
const MLB_TEAMS: Array<{ id: number; abbrev: string; name: string }> = [
  { id: 133, abbrev: "ATH", name: "Athletics" },
  { id: 144, abbrev: "ATL", name: "Atlanta Braves" },
  { id: 109, abbrev: "ARI", name: "Arizona Diamondbacks" }, // API='AZ', engine='ARI'
  { id: 110, abbrev: "BAL", name: "Baltimore Orioles" },
  { id: 111, abbrev: "BOS", name: "Boston Red Sox" },
  { id: 112, abbrev: "CHC", name: "Chicago Cubs" },
  { id: 113, abbrev: "CIN", name: "Cincinnati Reds" },
  { id: 114, abbrev: "CLE", name: "Cleveland Guardians" },
  { id: 115, abbrev: "COL", name: "Colorado Rockies" },
  { id: 145, abbrev: "CWS", name: "Chicago White Sox" },
  { id: 116, abbrev: "DET", name: "Detroit Tigers" },
  { id: 117, abbrev: "HOU", name: "Houston Astros" },
  { id: 118, abbrev: "KC",  name: "Kansas City Royals" },
  { id: 108, abbrev: "LAA", name: "Los Angeles Angels" },
  { id: 119, abbrev: "LAD", name: "Los Angeles Dodgers" },
  { id: 146, abbrev: "MIA", name: "Miami Marlins" },
  { id: 158, abbrev: "MIL", name: "Milwaukee Brewers" },
  { id: 142, abbrev: "MIN", name: "Minnesota Twins" },
  { id: 121, abbrev: "NYM", name: "New York Mets" },
  { id: 147, abbrev: "NYY", name: "New York Yankees" },
  { id: 143, abbrev: "PHI", name: "Philadelphia Phillies" },
  { id: 134, abbrev: "PIT", name: "Pittsburgh Pirates" },
  { id: 135, abbrev: "SD",  name: "San Diego Padres" },
  { id: 136, abbrev: "SEA", name: "Seattle Mariners" },
  { id: 137, abbrev: "SF",  name: "San Francisco Giants" },
  { id: 138, abbrev: "STL", name: "St. Louis Cardinals" },
  { id: 139, abbrev: "TB",  name: "Tampa Bay Rays" },
  { id: 140, abbrev: "TEX", name: "Texas Rangers" },
  { id: 141, abbrev: "TOR", name: "Toronto Blue Jays" },
  { id: 120, abbrev: "WSH", name: "Washington Nationals" },
];

// ─── wOBA Weights (2026 linear weights) ──────────────────────────────────────
const WOBA_WEIGHTS = {
  bb:  0.690,
  hbp: 0.722,
  s1b: 0.888,
  d2b: 1.271,
  t3b: 1.616,
  hr:  2.101,
};

// ─── Derived Metrics ──────────────────────────────────────────────────────────

function computeDerivedMetrics(st: Record<string, any>): {
  hr9: number | null;
  bb9: number | null;
  k9: number | null;
  woba: number | null;
} {
  const ab = Number(st.atBats) || 0;
  const hr = Number(st.homeRuns) || 0;
  const bb = Number(st.baseOnBalls) || 0;
  const k  = Number(st.strikeOuts) || 0;
  const h  = Number(st.hits) || 0;
  const d  = Number(st.doubles) || 0;
  const t  = Number(st.triples) || 0;
  const hbp = Number(st.hitByPitch) || 0;

  if (ab === 0) return { hr9: null, bb9: null, k9: null, woba: null };

  // Per-9 rates (using AB as proxy for outs/PA denominator)
  const hr9 = (hr / ab) * 27;
  const bb9 = (bb / ab) * 27;
  const k9  = (k  / ab) * 27;

  // wOBA: singles = H - 2B - 3B - HR
  const singles = Math.max(0, h - d - t - hr);
  const woba = (
    WOBA_WEIGHTS.bb  * bb  +
    WOBA_WEIGHTS.hbp * hbp +
    WOBA_WEIGHTS.s1b * singles +
    WOBA_WEIGHTS.d2b * d  +
    WOBA_WEIGHTS.t3b * t  +
    WOBA_WEIGHTS.hr  * hr
  ) / (ab + bb + hbp);

  return {
    hr9: Math.round(hr9 * 10000) / 10000,
    bb9: Math.round(bb9 * 10000) / 10000,
    k9:  Math.round(k9  * 10000) / 10000,
    woba: Math.round(woba * 10000) / 10000,
  };
}

// ─── MLB API Fetch ────────────────────────────────────────────────────────────

async function fetchTeamBattingSplits(teamId: number, teamAbbrev: string, teamName: string): Promise<Array<{
  hand: string;
  stat: Record<string, any>;
}>> {
  const url = `https://statsapi.mlb.com/api/v1/teams/${teamId}/stats?stats=statSplits&group=hitting&season=2026&sitCodes=vl,vr`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for team ${teamAbbrev} (${teamId})`);
  const data = await res.json();

  const splits = data?.stats?.[0]?.splits ?? [];
  if (splits.length === 0) {
    throw new Error(`No batting splits data for ${teamAbbrev} (${teamId})`);
  }

  return splits.map((s: any) => ({
    hand: s.split?.code === "vl" ? "L" : "R",
    stat: s.stat,
  }));
}

// ─── Concurrency Pool ─────────────────────────────────────────────────────────

async function runConcurrent<T>(
  items: T[],
  fn: (item: T, idx: number) => Promise<void>,
  concurrency: number
): Promise<void> {
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function seedTeamBattingSplits(): Promise<{
  total: number;
  upserted: number;
  errors: number;
}> {
  const db = await getDb();
  const now = Date.now();

  console.log("[INPUT] Starting team batting splits seed for all 30 MLB teams...");
  console.log(`[STATE] Season: 2026 | sitCodes: vl (vs LHP), vr (vs RHP)`);
  console.log(`[STATE] wOBA weights: BB=${WOBA_WEIGHTS.bb} 1B=${WOBA_WEIGHTS.s1b} 2B=${WOBA_WEIGHTS.d2b} 3B=${WOBA_WEIGHTS.t3b} HR=${WOBA_WEIGHTS.hr}`);

  const rowsToUpsert: Array<{
    teamAbbrev: string;
    mlbTeamId: number;
    hand: string;
    avg: number | null;
    obp: number | null;
    slg: number | null;
    ops: number | null;
    homeRuns: number | null;
    atBats: number | null;
    baseOnBalls: number | null;
    strikeOuts: number | null;
    hits: number | null;
    gamesPlayed: number | null;
    hr9: number | null;
    bb9: number | null;
    k9: number | null;
    woba: number | null;
  }> = [];

  let fetchErrors = 0;

  // ── Step 1: Fetch all teams in parallel ────────────────────────────────────
  console.log(`\n[STEP] Fetching batting splits for ${MLB_TEAMS.length} teams (concurrency=10)...`);

  await runConcurrent(MLB_TEAMS, async (team, i) => {
    const prefix = `  [${i + 1}/${MLB_TEAMS.length}] ${team.abbrev} (${team.name})`;
    try {
      const splits = await fetchTeamBattingSplits(team.id, team.abbrev, team.name);

      for (const { hand, stat } of splits) {
        const derived = computeDerivedMetrics(stat);

        // Parse slash line
        const avg = parseFloat(stat.avg) || null;
        const obp = parseFloat(stat.obp) || null;
        const slg = parseFloat(stat.slg) || null;
        const ops = parseFloat(stat.ops) || null;

        console.log(
          `${prefix} vs ${hand}HP: avg=${stat.avg} obp=${stat.obp} slg=${stat.slg} ops=${stat.ops} ` +
          `HR=${stat.homeRuns} AB=${stat.atBats} BB=${stat.baseOnBalls} K=${stat.strikeOuts} ` +
          `| hr9=${derived.hr9?.toFixed(3)} bb9=${derived.bb9?.toFixed(3)} k9=${derived.k9?.toFixed(3)} woba=${derived.woba?.toFixed(3)}`
        );

        rowsToUpsert.push({
          teamAbbrev: team.abbrev,
          mlbTeamId: team.id,
          hand,
          avg,
          obp,
          slg,
          ops,
          homeRuns: Number(stat.homeRuns) || null,
          atBats: Number(stat.atBats) || null,
          baseOnBalls: Number(stat.baseOnBalls) || null,
          strikeOuts: Number(stat.strikeOuts) || null,
          hits: Number(stat.hits) || null,
          gamesPlayed: Number(stat.gamesPlayed) || null,
          hr9: derived.hr9,
          bb9: derived.bb9,
          k9: derived.k9,
          woba: derived.woba,
        });
      }
    } catch (e: any) {
      fetchErrors++;
      console.error(`${prefix} — ✗ ERROR: ${e.message}`);
    }
  }, 10);

  console.log(`\n[STATE] Fetch complete: ${rowsToUpsert.length} rows to upsert, ${fetchErrors} team fetch errors`);

  // ── Step 2: Upsert all rows ────────────────────────────────────────────────
  console.log(`[STEP] Upserting ${rowsToUpsert.length} rows into mlb_team_batting_splits...`);
  let upserted = 0;
  let upsertErrors = 0;

  for (const row of rowsToUpsert) {
    try {
      // Check if row exists
      const existing = await db.select({ id: mlbTeamBattingSplits.id })
        .from(mlbTeamBattingSplits)
        .where(and(
          eq(mlbTeamBattingSplits.teamAbbrev, row.teamAbbrev),
          eq(mlbTeamBattingSplits.hand, row.hand)
        ))
        .limit(1);

      if (existing.length > 0) {
        await db.update(mlbTeamBattingSplits)
          .set({ ...row, lastFetchedAt: now })
          .where(and(
            eq(mlbTeamBattingSplits.teamAbbrev, row.teamAbbrev),
            eq(mlbTeamBattingSplits.hand, row.hand)
          ));
      } else {
        await db.insert(mlbTeamBattingSplits).values({ ...row, lastFetchedAt: now });
      }
      upserted++;
    } catch (e: any) {
      upsertErrors++;
      console.error(`  [ERROR] DB upsert failed for ${row.teamAbbrev} vs ${row.hand}HP: ${e.message}`);
    }
  }

  // ── Step 3: Validation ─────────────────────────────────────────────────────
  const totalRows = await db.select({ id: mlbTeamBattingSplits.id }).from(mlbTeamBattingSplits);
  const totalErrors = fetchErrors + upsertErrors;

  console.log("\n[OUTPUT] Team batting splits seed complete:");
  console.log(`  Teams processed:   ${MLB_TEAMS.length}`);
  console.log(`  Rows upserted:     ${upserted}`);
  console.log(`  Total DB rows:     ${totalRows.length}`);
  console.log(`  Fetch errors:      ${fetchErrors}`);
  console.log(`  DB upsert errors:  ${upsertErrors}`);

  // Sample verification
  const sample = await db.select().from(mlbTeamBattingSplits).limit(6);
  console.log("\n[VERIFY] Sample rows:");
  for (const r of sample) {
    console.log(`  ${r.teamAbbrev} vs ${r.hand}HP: avg=${r.avg} obp=${r.obp} slg=${r.slg} ops=${r.ops} woba=${r.woba?.toFixed(3)} hr9=${r.hr9?.toFixed(3)}`);
  }

  // Validate 60 rows (30 teams × 2 hands)
  if (totalRows.length === 60) {
    console.log("[VERIFY] ✅ PASS — Exactly 60 rows (30 teams × 2 hands)");
  } else {
    console.log(`[VERIFY] ⚠ Expected 60 rows, got ${totalRows.length}`);
  }

  if (totalErrors === 0) {
    console.log("[VERIFY] ✅ PASS — 0 errors");
  } else {
    console.log(`[VERIFY] ⚠ ${totalErrors} total errors`);
  }

  return { total: rowsToUpsert.length, upserted, errors: totalErrors };
}

// ─── CLI Entry Point ──────────────────────────────────────────────────────────
// NOTE: must match on the script filename, not `import.meta.url === file://argv[1]` —
// inside the esbuild server bundle every module's import.meta.url equals the entry
// file's URL, so that comparison is true at server boot and process.exit() here
// kills the production server (observed as an instant crash at Railway boot).
if (process.argv[1]?.endsWith("seedTeamBattingSplits.ts")) {
  seedTeamBattingSplits()
    .then((r) => {
      console.log("\n[DONE]", r);
      process.exit(0);
    })
    .catch((e) => {
      console.error("[FATAL]", e);
      process.exit(1);
    });
}
