/**
 * seedUmpireModifiers.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Computes per-umpire K/BB rate modifiers from 2024/2025/2026 MLB boxscores.
 *
 * METHODOLOGY:
 *   1. Fetch full schedule for each season (gameType=R, completed games only)
 *   2. For each completed game, fetch boxscore to get:
 *      - HP umpire ID + name (officials array)
 *      - Total Ks (away + home pitching strikeOuts)
 *      - Total BBs (away + home pitching baseOnBalls)
 *      - Total batters faced (away + home pitching battersFaced)
 *   3. Accumulate per-umpire: totalK, totalBB, totalBF, gamesUmpired
 *   4. Compute per-umpire: kRate = totalK/totalBF, bbRate = totalBB/totalBF
 *   5. Compute league avg: leagueKRate, leagueBBRate
 *   6. Compute modifiers: kMod = umpKRate / leagueKRate, bbMod = umpBBRate / leagueBBRate
 *   7. Upsert into mlb_umpire_modifiers table
 *
 * CONCURRENCY: 10 parallel boxscore fetches with 50ms delay between batches
 * RATE LIMIT: ~200ms effective per game (10 parallel × 50ms stagger)
 *
 * LOGGING FORMAT: [INPUT] [STEP] [STATE] [OUTPUT] [VERIFY]
 */

import { getDb } from "./db";
import { mlbUmpireModifiers } from "../drizzle/schema";
import { eq, inArray } from "drizzle-orm";

const MLB_STATS_BASE = "https://statsapi.mlb.com/api/v1";
const SEASONS = [2024, 2025, 2026] as const;
const CONCURRENCY = 10;
const BATCH_DELAY_MS = 100;

interface GameRef {
  gamePk: number;
  season: number;
}

interface BoxscoreResult {
  gamePk: number;
  season: number;
  umpireId: number;
  umpireName: string;
  totalK: number;
  totalBB: number;
  totalBF: number;
  error?: string;
}

interface UmpireAccum {
  umpireId: number;
  umpireName: string;
  totalK: number;
  totalBB: number;
  totalBF: number;
  games: number;
}

async function fetchWithTimeout(url: string, timeoutMs = 10000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAllGameRefs(): Promise<GameRef[]> {
  const allGames: GameRef[] = [];
  for (const season of SEASONS) {
    console.log(`[STEP] Fetching schedule for ${season}...`);
    const data = await fetchWithTimeout(
      `${MLB_STATS_BASE}/schedule?sportId=1&season=${season}&gameType=R`
    );
    let count = 0;
    for (const date of data.dates ?? []) {
      for (const game of date.games ?? []) {
        if (game.status?.abstractGameState === "Final") {
          allGames.push({ gamePk: game.gamePk, season });
          count++;
        }
      }
    }
    console.log(`[STATE] Season ${season}: ${count} completed games found`);
  }
  return allGames;
}

async function fetchBoxscore(ref: GameRef): Promise<BoxscoreResult> {
  try {
    const bs = await fetchWithTimeout(
      `${MLB_STATS_BASE}/game/${ref.gamePk}/boxscore`
    );
    const officials: any[] = bs.officials ?? [];
    const hp = officials.find((o: any) => o.officialType === "Home Plate");
    if (!hp) {
      return {
        ...ref,
        umpireId: 0,
        umpireName: "Unknown",
        totalK: 0,
        totalBB: 0,
        totalBF: 0,
        error: "no HP umpire",
      };
    }

    const awayPitch = bs.teams?.away?.teamStats?.pitching ?? {};
    const homePitch = bs.teams?.home?.teamStats?.pitching ?? {};

    const totalK = (awayPitch.strikeOuts ?? 0) + (homePitch.strikeOuts ?? 0);
    const totalBB = (awayPitch.baseOnBalls ?? 0) + (homePitch.baseOnBalls ?? 0);
    const totalBF =
      (awayPitch.battersFaced ?? 0) + (homePitch.battersFaced ?? 0);

    return {
      gamePk: ref.gamePk,
      season: ref.season,
      umpireId: hp.official.id,
      umpireName: hp.official.fullName,
      totalK,
      totalBB,
      totalBF,
    };
  } catch (e: any) {
    return {
      ...ref,
      umpireId: 0,
      umpireName: "Unknown",
      totalK: 0,
      totalBB: 0,
      totalBF: 0,
      error: e.message,
    };
  }
}

async function processBatch(batch: GameRef[]): Promise<BoxscoreResult[]> {
  return Promise.all(batch.map(ref => fetchBoxscore(ref)));
}

export async function seedUmpireModifiers(): Promise<{
  inserted: number;
  updated: number;
  errors: number;
}> {
  console.log("[INPUT] Starting umpire modifier seeder");
  console.log(
    `[INPUT] Seasons: ${SEASONS.join(", ")} | Concurrency: ${CONCURRENCY}`
  );

  // ── Step 1: Fetch all game refs ──────────────────────────────────────────
  const allGames = await fetchAllGameRefs();
  console.log(
    `\n[STATE] Total completed games across all seasons: ${allGames.length}`
  );

  // ── Step 2: Fetch boxscores in concurrent batches ────────────────────────
  console.log(
    `\n[STEP] Fetching ${allGames.length} boxscores in batches of ${CONCURRENCY}...`
  );

  const umpireMap = new Map<number, UmpireAccum>();
  let processed = 0;
  let errors = 0;
  let noHp = 0;

  for (let i = 0; i < allGames.length; i += CONCURRENCY) {
    const batch = allGames.slice(i, i + CONCURRENCY);
    const results = await processBatch(batch);

    for (const r of results) {
      if (r.error) {
        if (r.error === "no HP umpire") noHp++;
        else errors++;
        continue;
      }
      if (r.umpireId === 0) {
        noHp++;
        continue;
      }
      if (r.totalBF < 10) continue; // skip games with insufficient data

      const existing = umpireMap.get(r.umpireId);
      if (existing) {
        existing.totalK += r.totalK;
        existing.totalBB += r.totalBB;
        existing.totalBF += r.totalBF;
        existing.games++;
      } else {
        umpireMap.set(r.umpireId, {
          umpireId: r.umpireId,
          umpireName: r.umpireName,
          totalK: r.totalK,
          totalBB: r.totalBB,
          totalBF: r.totalBF,
          games: 1,
        });
      }
      processed++;
    }

    // Progress log every 100 batches
    if (Math.floor(i / CONCURRENCY) % 10 === 0) {
      const pct = (((i + batch.length) / allGames.length) * 100).toFixed(1);
      console.log(
        `[STATE] Progress: ${i + batch.length}/${allGames.length} (${pct}%) | umpires tracked: ${umpireMap.size} | errors: ${errors}`
      );
    }

    await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
  }

  console.log(
    `\n[STATE] Boxscore fetch complete: processed=${processed} errors=${errors} noHp=${noHp} uniqueUmpires=${umpireMap.size}`
  );

  // ── Step 3: Compute league averages ─────────────────────────────────────
  console.log("\n[STEP] Computing league-wide K-rate and BB-rate...");
  let leagueTotalK = 0,
    leagueTotalBB = 0,
    leagueTotalBF = 0;
  for (const u of Array.from(umpireMap.values())) {
    leagueTotalK += u.totalK;
    leagueTotalBB += u.totalBB;
    leagueTotalBF += u.totalBF;
  }
  const leagueKRate = leagueTotalBF > 0 ? leagueTotalK / leagueTotalBF : 0.22;
  const leagueBBRate =
    leagueTotalBF > 0 ? leagueTotalBB / leagueTotalBF : 0.085;
  console.log(
    `[STATE] League: totalK=${leagueTotalK} totalBB=${leagueTotalBB} totalBF=${leagueTotalBF}`
  );
  console.log(
    `[STATE] League: kRate=${leagueKRate.toFixed(4)} bbRate=${leagueBBRate.toFixed(4)}`
  );

  // Validate league averages (MLB 2024: K-rate ~22%, BB-rate ~8.5%)
  if (leagueKRate < 0.18 || leagueKRate > 0.28) {
    console.warn(
      `[VERIFY] WARN — leagueKRate=${leagueKRate.toFixed(4)} outside expected [0.18, 0.28]`
    );
  }
  if (leagueBBRate < 0.06 || leagueBBRate > 0.12) {
    console.warn(
      `[VERIFY] WARN — leagueBBRate=${leagueBBRate.toFixed(4)} outside expected [0.06, 0.12]`
    );
  }

  // ── Step 4: Compute per-umpire modifiers and upsert ─────────────────────
  console.log("\n[STEP] Computing per-umpire modifiers and upserting...");
  const db = await getDb();
  const now = Date.now();
  let inserted = 0,
    updated = 0,
    dbErrors = 0;

  // Filter: only umpires with >= 20 games (sufficient sample)
  const qualifiedUmpires = Array.from(umpireMap.values()).filter(
    u => u.games >= 20
  );
  // totalBF not in schema — compute from K+BB+H proxy; we use totalK and totalBb
  console.log(
    `[STATE] Qualified umpires (>=20 games): ${qualifiedUmpires.length} of ${umpireMap.size} total`
  );

  for (const u of qualifiedUmpires) {
    const kRate = u.totalBF > 0 ? u.totalK / u.totalBF : leagueKRate;
    const bbRate = u.totalBF > 0 ? u.totalBB / u.totalBF : leagueBBRate;
    const kMod = leagueKRate > 0 ? kRate / leagueKRate : 1.0;
    const bbMod = leagueBBRate > 0 ? bbRate / leagueBBRate : 1.0;

    // Validate modifiers (should be between 0.70 and 1.30)
    if (kMod < 0.7 || kMod > 1.3) {
      console.warn(
        `[VERIFY] WARN — ${u.umpireName} kMod=${kMod.toFixed(4)} outside [0.70, 1.30] (games=${u.games})`
      );
    }

    console.log(
      `[STATE] ${u.umpireName} (id=${u.umpireId}): games=${u.games} kRate=${kRate.toFixed(4)} bbRate=${bbRate.toFixed(4)} kMod=${kMod.toFixed(4)} bbMod=${bbMod.toFixed(4)}`
    );

    try {
      const existing = await db
        .select({ id: mlbUmpireModifiers.id })
        .from(mlbUmpireModifiers)
        .where(eq(mlbUmpireModifiers.umpireId, u.umpireId))
        .limit(1);

      const row = {
        umpireId: u.umpireId,
        umpireName: u.umpireName,
        gamesHp: u.games,
        totalK: u.totalK,
        totalBb: u.totalBB,
        kRate,
        bbRate,
        kModifier: kMod,
        bbModifier: bbMod,
        seasonsIncluded: SEASONS.join(","),
        lastFetchedAt: now,
      };

      if (existing.length > 0) {
        await db
          .update(mlbUmpireModifiers)
          .set(row)
          .where(eq(mlbUmpireModifiers.umpireId, u.umpireId));
        updated++;
      } else {
        await db.insert(mlbUmpireModifiers).values(row);
        inserted++;
      }
    } catch (e: any) {
      console.error(`[ERROR] ${u.umpireName}: DB upsert failed — ${e.message}`);
      dbErrors++;
    }
  }

  // ── Step 5: Final validation ─────────────────────────────────────────────
  console.log("\n[OUTPUT] Umpire modifier seeder complete");
  console.log(
    `[OUTPUT] inserted=${inserted} updated=${updated} dbErrors=${dbErrors}`
  );

  const allRows = await db
    .select({
      umpireName: mlbUmpireModifiers.umpireName,
      totalGames: mlbUmpireModifiers.gamesHp,
      kMod: mlbUmpireModifiers.kModifier,
      bbMod: mlbUmpireModifiers.bbModifier,
      kRate: mlbUmpireModifiers.kRate,
      bbRate: mlbUmpireModifiers.bbRate,
    })
    .from(mlbUmpireModifiers);

  const sortedK = [...allRows].sort(
    (a: any, b: any) => (b.kMod ?? 0) - (a.kMod ?? 0)
  );
  console.log("\n[VERIFY] Top 5 high-K umpires (kMod):");
  sortedK.slice(0, 5).forEach((r: any) => {
    console.log(
      `  ${r.umpireName}: kMod=${r.kMod?.toFixed(4)} bbMod=${r.bbMod?.toFixed(4)} kRate=${r.kRate?.toFixed(4)} games=${r.totalGames}`
    );
  });
  console.log("[VERIFY] Top 5 low-K umpires (kMod):");
  sortedK
    .slice(-5)
    .reverse()
    .forEach((r: any) => {
      console.log(
        `  ${r.umpireName}: kMod=${r.kMod?.toFixed(4)} bbMod=${r.bbMod?.toFixed(4)} kRate=${r.kRate?.toFixed(4)} games=${r.totalGames}`
      );
    });

  const sortedBB = [...allRows].sort(
    (a: any, b: any) => (b.bbMod ?? 0) - (a.bbMod ?? 0)
  );
  console.log("[VERIFY] Top 5 high-BB umpires (bbMod):");
  sortedBB.slice(0, 5).forEach((r: any) => {
    console.log(
      `  ${r.umpireName}: bbMod=${r.bbMod?.toFixed(4)} kMod=${r.kMod?.toFixed(4)} games=${r.totalGames}`
    );
  });

  console.log(`\n[VERIFY] Total umpires in DB: ${allRows.length}`);
  if (dbErrors === 0) {
    console.log(
      `[VERIFY] PASS — ${inserted + updated} umpire modifiers seeded with 0 DB errors`
    );
  } else {
    console.error(`[VERIFY] FAIL — ${dbErrors} DB errors during seeding`);
  }
  return { inserted, updated, errors: dbErrors };
}

// Self-invoke only when run directly (tsx seedUmpireModifiers.ts)
if (
  process.argv[1]?.endsWith("seedUmpireModifiers.ts") ||
  process.argv[1]?.endsWith("seedUmpireModifiers.js")
) {
  seedUmpireModifiers().catch(e => {
    console.error("[ERROR] Fatal:", e.message);
    process.exit(1);
  });
}
