/**
 * seedPitcherStats.ts
 *
 * Fetches 2026 MLB season pitching stats for all active starters (GS >= 1, IP >= 10)
 * from the MLB Stats API and upserts them into the mlb_pitcher_stats table.
 *
 * Can be run manually:
 *   npx tsx server/seedPitcherStats.ts
 *
 * Or called programmatically from the cron scheduler.
 *
 * MLB Stats API endpoint:
 *   https://statsapi.mlb.com/api/v1/stats?stats=season&group=pitching&season=2026
 *     &playerPool=All&limit=1000&fields=...
 *
 * Upsert key: (mlbamId, teamAbbrev)
 * Fallback: if xERA not available, store null
 */

import { getDb } from "./db";
import { mlbPitcherStats } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";

// ─── MLB Stats API team abbreviation map ─────────────────────────────────────
// Maps MLB Stats API teamId → our standard abbreviation (matches TEAM_STATS_2025 keys)
const TEAM_ID_TO_ABBREV: Record<number, string> = {
  108: "LAA",
  109: "ARI",
  110: "BAL",
  111: "BOS",
  112: "CHC",
  113: "CIN",
  114: "CLE",
  115: "COL",
  116: "DET",
  117: "HOU",
  118: "KC",
  119: "LAD",
  120: "WSH",
  121: "NYM",
  133: "ATH",
  134: "PIT",
  135: "SD",
  136: "SEA",
  137: "SF",
  138: "STL",
  139: "TB",
  140: "TEX",
  141: "TOR",
  142: "MIN",
  143: "PHI",
  144: "ATL",
  145: "CWS",
  146: "MIA",
  147: "NYY",
  158: "MIL",
};

interface MlbApiStat {
  player: { id: number; fullName: string };
  team?: { id: number; name: string };
  stat: {
    era?: string;
    strikeoutsPer9Inn?: string;
    walksPer9Inn?: string;
    homeRunsPer9?: string;
    whip?: string;
    inningsPitched?: string;
    gamesStarted?: number;
    gamesPlayed?: number;
  };
}

interface PitcherRecord {
  mlbamId: number;
  fullName: string;
  teamAbbrev: string;
  era: number | null;
  k9: number | null;
  bb9: number | null;
  hr9: number | null;
  whip: number | null;
  ip: number | null;
  gamesStarted: number;
  gamesPlayed: number;
  xera: number | null;
  lastFetchedAt: number;
}

function parseFloat2(val: string | undefined | null): number | null {
  if (val == null || val === "" || val === "-.--" || val === "-") return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

/**
 * Convert MLB Stats API inningsPitched string (e.g. "162.1") to decimal IP.
 * The fractional part represents thirds of an inning: .1 = 1/3, .2 = 2/3
 */
function parseIP(val: string | undefined | null): number | null {
  if (val == null || val === "") return null;
  const parts = val.split(".");
  const whole = parseInt(parts[0] ?? "0", 10);
  const frac = parseInt(parts[1] ?? "0", 10); // 0, 1, or 2
  return whole + frac / 3;
}

/**
 * Fetch all 2025 pitching stats from MLB Stats API.
 * Returns raw stat objects for all pitchers with at least 1 GS and 10 IP.
 * Pitchers not in the bulk API (injury returns, spot-starters) will receive
 * their team's SP average stats at the engine lookup layer — no supplemental
 * individual lookups are performed here.
 */
async function fetchMlbPitchingStats(): Promise<PitcherRecord[]> {
  console.log("[STEP] Fetching 2026 MLB pitching stats from MLB Stats API...");

  const url =
    "https://statsapi.mlb.com/api/v1/stats" +
    "?stats=season" +
    "&group=pitching" +
    "&season=2026" +
    "&playerPool=All" +
    "&limit=2000" +
    "&fields=stats,splits,player,id,fullName,team,id,name,stat,era,strikeoutsPer9Inn,walksPer9Inn,homeRunsPer9,whip,inningsPitched,gamesStarted,gamesPlayed";

  const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!resp.ok) {
    throw new Error(`MLB Stats API HTTP ${resp.status}: ${resp.statusText}`);
  }

  const data = await resp.json() as { stats: Array<{ splits: MlbApiStat[] }> };
  const splits: MlbApiStat[] = data.stats?.[0]?.splits ?? [];

  console.log(`[STATE] Total pitchers returned by API: ${splits.length}`);

  const records: PitcherRecord[] = [];
  const now = Date.now();

  for (const s of splits) {
    const playerId = s.player?.id;
    const fullName = s.player?.fullName;
    const teamId = s.team?.id;

    if (!playerId || !fullName) continue;

    const ip = parseIP(s.stat?.inningsPitched);
    const gs = s.stat?.gamesStarted ?? 0;
    const gp = s.stat?.gamesPlayed ?? 0;

    // Filter: must have at least 1 GS and 10 IP
    if (gs < 1 || (ip !== null && ip < 10)) continue;

    const teamAbbrev = teamId ? (TEAM_ID_TO_ABBREV[teamId] ?? "UNK") : "UNK";

    records.push({
      mlbamId: playerId,
      fullName,
      teamAbbrev,
      era: parseFloat2(s.stat?.era),
      k9: parseFloat2(s.stat?.strikeoutsPer9Inn),
      bb9: parseFloat2(s.stat?.walksPer9Inn),
      hr9: parseFloat2(s.stat?.homeRunsPer9),
      whip: parseFloat2(s.stat?.whip),
      ip,
      gamesStarted: gs,
      gamesPlayed: gp,
      xera: null, // MLB Stats API does not provide xERA; null is correct
      lastFetchedAt: now,
    });
  }

  console.log(`[STATE] Pitchers after GS>=1, IP>=10 filter: ${records.length}`);
  return records;
}

/**
 * Upsert pitcher stats into the mlb_pitcher_stats table.
 * Uses (mlbamId, teamAbbrev) as the upsert key.
 */
async function upsertPitcherStats(records: PitcherRecord[]): Promise<{ inserted: number; updated: number; errors: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  let inserted = 0;
  let updated = 0;
  let errors = 0;

  for (const rec of records) {
    try {
      // Check if row exists
      const existing = await db
        .select({ id: mlbPitcherStats.id })
        .from(mlbPitcherStats)
        .where(
          and(
            eq(mlbPitcherStats.mlbamId, rec.mlbamId),
            eq(mlbPitcherStats.teamAbbrev, rec.teamAbbrev)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        // Update existing row
        await db
          .update(mlbPitcherStats)
          .set({
            fullName: rec.fullName,
            era: rec.era,
            k9: rec.k9,
            bb9: rec.bb9,
            hr9: rec.hr9,
            whip: rec.whip,
            ip: rec.ip,
            gamesStarted: rec.gamesStarted,
            gamesPlayed: rec.gamesPlayed,
            // xera intentionally omitted: the API never provides it, and setting it
            // to null here would clobber backfilled xERA values on every refresh.
            lastFetchedAt: rec.lastFetchedAt,
          })
          .where(
            and(
              eq(mlbPitcherStats.mlbamId, rec.mlbamId),
              eq(mlbPitcherStats.teamAbbrev, rec.teamAbbrev)
            )
          );
        updated++;
      } else {
        // Insert new row
        await db.insert(mlbPitcherStats).values({
          mlbamId: rec.mlbamId,
          fullName: rec.fullName,
          teamAbbrev: rec.teamAbbrev,
          era: rec.era,
          k9: rec.k9,
          bb9: rec.bb9,
          hr9: rec.hr9,
          whip: rec.whip,
          ip: rec.ip,
          gamesStarted: rec.gamesStarted,
          gamesPlayed: rec.gamesPlayed,
          xera: rec.xera,
          lastFetchedAt: rec.lastFetchedAt,
        });
        inserted++;
      }
    } catch (err) {
      console.error(`[ERROR] Failed to upsert ${rec.fullName} (${rec.teamAbbrev}):`, err);
      errors++;
    }
  }

  return { inserted, updated, errors };
}

/**
 * Main entry point: fetch + upsert all pitcher stats.
 * Returns summary stats for logging.
 */
export async function seedPitcherStats(): Promise<{ total: number; inserted: number; updated: number; errors: number }> {
  console.log("[INPUT] Starting pitcher stats seed/refresh for 2026 season");

  const records = await fetchMlbPitchingStats();

  if (records.length === 0) {
    console.warn("[VERIFY] FAIL — No pitcher records fetched. MLB Stats API may be unavailable or season not started.");
    return { total: 0, inserted: 0, updated: 0, errors: 0 };
  }

  console.log(`[STEP] Upserting ${records.length} pitcher records into mlb_pitcher_stats...`);
  const { inserted, updated, errors } = await upsertPitcherStats(records);

  const total = records.length;
  console.log(`[OUTPUT] Pitcher stats upsert complete: total=${total} inserted=${inserted} updated=${updated} errors=${errors}`);
  console.log(`[VERIFY] ${errors === 0 ? "PASS" : "FAIL"} — ${errors} errors`);

  return { total, inserted, updated, errors };
}

// ─── CLI entry point ──────────────────────────────────────────────────────────
// Run directly: npx tsx server/seedPitcherStats.ts
// NOTE: must match on the script filename, not `import.meta.url === file://argv[1]` —
// inside the esbuild server bundle every module's import.meta.url equals the entry
// file's URL, so that comparison is true at server boot and process.exit() here
// kills the production server (observed as an instant crash at Railway boot).
if (process.argv[1]?.endsWith("seedPitcherStats.ts")) {
  seedPitcherStats()
    .then((result) => {
      console.log("[DONE]", result);
      process.exit(0);
    })
    .catch((err) => {
      console.error("[FATAL]", err);
      process.exit(1);
    });
}
