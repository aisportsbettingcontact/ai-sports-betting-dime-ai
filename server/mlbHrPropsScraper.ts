/**
 * mlbHrPropsScraper.ts
 * ====================
 * TypeScript orchestrator for Action Network HR Props ingestion.
 *
 * EXECUTION FLOW:
 *   [INPUT]  Date string (YYYY-MM-DD) → query DB for all games on that date
 *   [STEP 1] Build dbGameMap: "AWAY@HOME|YYYY-MM-DD" → db_game_id
 *   [STEP 2] Build lineupMap: db_game_id → Rotowire lineup data
 *   [STEP 3] Spawn ActionNetworkHRPropsAPI.py with stdin JSON
 *   [STEP 4] Parse stdout JSON → array of HR prop records
 *   [STEP 5] Upsert all records into mlb_hr_props table
 *   [OUTPUT] Return { inserted, updated, skipped, errors }
 *   [VERIFY] Log full audit of all games and player counts
 */

import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { eq, and, sql } from "drizzle-orm";
import { getDb } from "./db";
import { games, mlbLineups, mlbHrProps } from "../drizzle/schema";

// ── Logging ───────────────────────────────────────────────────────────────────

const TAG = "[HRPropsScraper]";
function log(msg: string): void {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`${TAG} [${ts}] ${msg}`);
}
function logErr(msg: string): void {
  const ts = new Date().toISOString().slice(11, 23);
  console.error(`${TAG} [ERROR] [${ts}] ${msg}`);
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface HrPropRecord {
  gameId: number;
  anEventId: number;
  gameDate: string;
  awayTeam: string;
  homeTeam: string;
  playerName: string;
  playerTeam: string;
  position: string;
  battingOrder: number | null;
  lineupConfirmed: boolean;
  overLine: number;
  overOdds: number | null;
  underOdds: number | null;
  impliedOverProb: number | null;
  anPlayerId: number;
}

interface ScrapeResult {
  date: string;
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
  totalRecords: number;
  gameBreakdown: Array<{
    gameId: number;
    matchup: string;
    players: number;
    lineupConfirmed: number;
  }>;
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function getGamesForDate(dateStr: string): Promise<
  Array<{
    id: number;
    awayTeam: string;
    homeTeam: string;
    gameDate: string;
    gameNumber: number;
  }>
> {
  log(`[STEP 1] Querying DB for games on ${dateStr}`);
  const db = await getDb();
  const rows = await db
    .select({
      id: games.id,
      awayTeam: games.awayTeam,
      homeTeam: games.homeTeam,
      gameDate: games.gameDate,
      gameNumber: games.gameNumber,
    })
    .from(games)
    .where(and(eq(games.gameDate, dateStr), eq(games.sport, "MLB")));
  log(`[STATE] Found ${rows.length} MLB games for ${dateStr}`);
  return rows as any[];
}

async function getLineupsForGames(
  gameIds: number[]
): Promise<Map<number, any>> {
  log(`[STEP 2] Fetching Rotowire lineups for ${gameIds.length} games`);
  if (gameIds.length === 0) return new Map();

  const db = await getDb();
  const rows = await db
    .select()
    .from(mlbLineups)
    .where(
      gameIds.length === 1
        ? eq(mlbLineups.gameId, gameIds[0])
        : sql`${mlbLineups.gameId} IN (${sql.join(
            gameIds.map(id => sql`${id}`),
            sql`, `
          )})`
    );

  const lineupMap = new Map<number, any>();
  for (const row of rows) {
    const awayLineup = row.awayLineup
      ? JSON.parse(row.awayLineup as string)
      : [];
    const homeLineup = row.homeLineup
      ? JSON.parse(row.homeLineup as string)
      : [];
    lineupMap.set(row.gameId, {
      awayLineup,
      homeLineup,
      awayLineupConfirmed: row.awayLineupConfirmed ?? false,
      homeLineupConfirmed: row.homeLineupConfirmed ?? false,
    });
  }
  log(`[STATE] Loaded ${lineupMap.size}/${gameIds.length} lineup records`);
  return lineupMap;
}

// ── Python engine invocation ──────────────────────────────────────────────────

async function runHrPropsPython(
  dateStr: string,
  dbGameMap: Record<string, number>,
  lineupMap: Record<number, any>
): Promise<HrPropRecord[]> {
  const _dirname = path.dirname(fileURLToPath(import.meta.url));
  const scriptPath = path.join(_dirname, "ActionNetworkHRPropsAPI.py");
  const inputPayload = JSON.stringify({
    dateStr,
    dbGameMap,
    lineupMap,
  });

  log(`[STEP 3] Spawning ActionNetworkHRPropsAPI.py`);
  log(
    `[STATE] dbGameMap entries=${Object.keys(dbGameMap).length} | lineupMap entries=${Object.keys(lineupMap).length}`
  );

  return new Promise((resolve, reject) => {
    const proc = spawn("python3.11", [scriptPath], {
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    proc.stdin.write(inputPayload);
    proc.stdin.end();

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      const lines = chunk.toString().split("\n").filter(Boolean);
      for (const line of lines) {
        // Forward Python logs to our console
        console.log(`  ${line}`);
        stderr += line + "\n";
      }
    });

    proc.on("close", code => {
      if (code !== 0) {
        logErr(`Python process exited with code ${code}`);
        logErr(`STDERR tail: ${stderr.slice(-500)}`);
        reject(
          new Error(`ActionNetworkHRPropsAPI.py exited with code ${code}`)
        );
        return;
      }

      // Extract the JSON array from stdout (last non-empty line)
      const lines = stdout.trim().split("\n").filter(Boolean);
      const jsonLine = lines.findLast(l => l.startsWith("["));
      if (!jsonLine) {
        logErr("No JSON array found in Python stdout");
        logErr(`STDOUT tail: ${stdout.slice(-500)}`);
        reject(new Error("No JSON output from ActionNetworkHRPropsAPI.py"));
        return;
      }

      try {
        const records: HrPropRecord[] = JSON.parse(jsonLine);
        log(`[STATE] Parsed ${records.length} HR prop records from Python`);
        resolve(records);
      } catch (e) {
        logErr(`JSON parse error: ${e}`);
        logErr(`JSON line (first 200): ${jsonLine.slice(0, 200)}`);
        reject(e);
      }
    });

    proc.on("error", err => {
      logErr(`Failed to spawn Python process: ${err.message}`);
      reject(err);
    });
  });
}

// ── DB upsert ─────────────────────────────────────────────────────────────────

async function upsertHrProps(records: HrPropRecord[]): Promise<{
  inserted: number;
  updated: number;
  errors: number;
}> {
  log(`[STEP 5] Upserting ${records.length} HR prop records to DB`);

  let inserted = 0;
  let updated = 0;
  let errors = 0;
  const now = Date.now();

  // Process in batches of 50
  const BATCH_SIZE = 50;
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    try {
      for (const rec of batch) {
        const db = await getDb();
        // Determine side: 'away' or 'home' based on playerTeam vs matchup
        const side = rec.playerTeam === rec.awayTeam ? "away" : "home";
        await db
          .insert(mlbHrProps)
          .values({
            gameId: rec.gameId,
            side,
            playerName: rec.playerName,
            anPlayerId: rec.anPlayerId,
            teamAbbrev: rec.playerTeam,
            bookLine: rec.overLine.toString(),
            consensusOverOdds:
              rec.overOdds != null
                ? rec.overOdds >= 0
                  ? `+${rec.overOdds}`
                  : `${rec.overOdds}`
                : null,
            consensusUnderOdds:
              rec.underOdds != null
                ? rec.underOdds >= 0
                  ? `+${rec.underOdds}`
                  : `${rec.underOdds}`
                : null,
            anNoVigOverPct: rec.impliedOverProb?.toString() ?? null,
          } as any)
          .onDuplicateKeyUpdate({
            set: {
              teamAbbrev: rec.playerTeam,
              consensusOverOdds:
                rec.overOdds != null
                  ? rec.overOdds >= 0
                    ? `+${rec.overOdds}`
                    : `${rec.overOdds}`
                  : null,
              consensusUnderOdds:
                rec.underOdds != null
                  ? rec.underOdds >= 0
                    ? `+${rec.underOdds}`
                    : `${rec.underOdds}`
                  : null,
              anNoVigOverPct: rec.impliedOverProb?.toString() ?? null,
            } as any,
          });
        inserted++;
      }
    } catch (e: any) {
      logErr(`Batch upsert error at i=${i}: ${e.message}`);
      errors += batch.length;
    }
  }

  log(
    `[OUTPUT] DB upsert complete: inserted/updated=${inserted} errors=${errors}`
  );
  return { inserted, updated, errors };
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function scrapeHrPropsForDate(
  dateStr: string
): Promise<ScrapeResult> {
  log(`=== MLB HR Props Scrape: ${dateStr} ===`);

  // Step 1: Get all games for date
  const gameRows = await getGamesForDate(dateStr);
  if (gameRows.length === 0) {
    log(`[VERIFY] No MLB games found for ${dateStr} — skipping`);
    return {
      date: dateStr,
      inserted: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
      totalRecords: 0,
      gameBreakdown: [],
    };
  }

  // Step 2: Build dbGameMap — "AWAY@HOME|YYYY-MM-DD" → db_game_id
  const dbGameMap: Record<string, number> = {};
  for (const g of gameRows) {
    const key = `${g.awayTeam}@${g.homeTeam}|${g.gameDate}`;
    dbGameMap[key] = g.id;
    log(`[STATE] Game map: ${key} → id=${g.id}`);
  }

  // Step 3: Get lineups for all games
  const gameIds = gameRows.map(g => g.id);
  const lineupMap = await getLineupsForGames(gameIds);

  // Convert Map to plain object for JSON serialization
  const lineupMapObj: Record<number, any> = {};
  lineupMap.forEach((lineup, gameId) => {
    lineupMapObj[gameId] = lineup;
  });

  // Step 4: Run Python scraper
  const dateForAN = dateStr.replace(/-/g, ""); // "20260405"
  let records: HrPropRecord[];
  try {
    records = await runHrPropsPython(dateForAN, dbGameMap, lineupMapObj);
  } catch (e: any) {
    logErr(`Python scraper failed: ${e.message}`);
    return {
      date: dateStr,
      inserted: 0,
      updated: 0,
      skipped: 0,
      errors: 1,
      totalRecords: 0,
      gameBreakdown: [],
    };
  }

  if (records.length === 0) {
    log(
      `[VERIFY] No HR prop records returned — AN may not have posted props yet`
    );
    return {
      date: dateStr,
      inserted: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
      totalRecords: 0,
      gameBreakdown: [],
    };
  }

  // Step 5: Upsert to DB
  const { inserted, updated, errors } = await upsertHrProps(records);

  // Build per-game breakdown for audit
  const gameBreakdown = new Map<
    number,
    { matchup: string; players: number; lineupConfirmed: number }
  >();
  for (const rec of records) {
    const existing = gameBreakdown.get(rec.gameId) ?? {
      matchup: `${rec.awayTeam}@${rec.homeTeam}`,
      players: 0,
      lineupConfirmed: 0,
    };
    existing.players++;
    if (rec.lineupConfirmed) existing.lineupConfirmed++;
    gameBreakdown.set(rec.gameId, existing);
  }

  const entries: [
    number,
    { matchup: string; players: number; lineupConfirmed: number },
  ][] = [];
  gameBreakdown.forEach((data, gameId) => entries.push([gameId, data]));
  const breakdown = entries.map(([gameId, data]) => ({
    gameId,
    ...data,
  }));

  // Final audit log
  log(`[VERIFY] === HR Props Scrape Complete ===`);
  log(`[VERIFY] Date: ${dateStr}`);
  log(`[VERIFY] Total records: ${records.length}`);
  log(`[VERIFY] DB upsert: inserted/updated=${inserted} errors=${errors}`);
  log(`[VERIFY] Games breakdown:`);
  for (const b of breakdown) {
    log(
      `[VERIFY]   ${b.matchup} (id=${b.gameId}): ${b.players} players | ${b.lineupConfirmed} lineup-confirmed`
    );
  }

  return {
    date: dateStr,
    inserted,
    updated,
    skipped: 0,
    errors,
    totalRecords: records.length,
    gameBreakdown: breakdown,
  };
}
