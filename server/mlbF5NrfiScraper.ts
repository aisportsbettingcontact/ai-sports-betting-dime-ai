/**
 * mlbF5NrfiScraper.ts
 * ===================
 * TypeScript orchestrator for scraping First Five Innings (F5) and
 * First Inning (NRFI/YRFI) odds from Action Network (FanDuel NJ source).
 *
 * Pipeline:
 *   1. Query DB for all MLB games on target date
 *   2. Build awayTeam+homeTeam → gameId map
 *   3. Spawn ActionNetworkF5NrfiAPI.py
 *   4. Match results by awayTeam+homeTeam key
 *   5. Write F5 and NRFI book odds to games table
 *
 * Matching strategy: awayTeam+homeTeam (case-insensitive, normalized)
 * Fallback: gameNumber-aware for doubleheaders (CHC@CLE G1 vs G2)
 */

import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { getDb } from "./db";
import { games } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";

const PYTHON_BIN = "/usr/bin/python3.11";
const PYTHON_ENV = {
  ...process.env,
  PYTHONHOME: undefined as unknown as string,
  PYTHONPATH:
    "/usr/local/lib/python3.11/dist-packages:/usr/lib/python3/dist-packages",
};
const _dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(_dirname, "ActionNetworkF5NrfiAPI.py");

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface F5Odds {
  awayMlOdds: number | null;
  homeMlOdds: number | null;
  awayRlValue: number | null;
  awayRlOdds: number | null;
  homeRlValue: number | null;
  homeRlOdds: number | null;
  totalValue: number | null;
  overOdds: number | null;
  underOdds: number | null;
}

interface NrfiOdds {
  totalValue: number | null;
  overOdds: number | null; // YRFI
  underOdds: number | null; // NRFI
}

interface AnF5NrfiRecord {
  anEventId: number;
  awayTeam: string;
  homeTeam: string;
  gameTime: string;
  f5: F5Odds;
  nrfi: NrfiOdds;
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function makeMatchKey(away: string, home: string): string {
  return `${away.toUpperCase().trim()}@${home.toUpperCase().trim()}`;
}

function oddsToString(odds: number | null): string | null {
  if (odds === null || odds === undefined) return null;
  return odds >= 0 ? `+${odds}` : `${odds}`;
}

function runPythonScraper(dateStr: string): Promise<AnF5NrfiRecord[]> {
  return new Promise((resolve, reject) => {
    console.log(`[STEP] Spawning ${PYTHON_BIN} ${SCRIPT_PATH} ${dateStr}`);
    const proc = spawn(PYTHON_BIN, [SCRIPT_PATH, dateStr], { env: PYTHON_ENV });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", d => {
      stdout += d.toString();
    });
    proc.stderr.on("data", d => {
      stderr += d.toString();
      // Print stderr logs in real time for visibility
      process.stdout.write(d.toString());
    });

    proc.on("close", code => {
      if (code !== 0) {
        reject(
          new Error(
            `[FATAL] ActionNetworkF5NrfiAPI.py exited with code ${code}\n${stderr}`
          )
        );
        return;
      }

      // Parse the last non-empty line as JSON
      const lines = stdout
        .trim()
        .split("\n")
        .filter(l => l.trim());
      const lastLine = lines[lines.length - 1];
      try {
        const parsed = JSON.parse(lastLine);
        if (parsed.error) {
          reject(new Error(`[FATAL] Python scraper error: ${parsed.error}`));
          return;
        }
        resolve(parsed as AnF5NrfiRecord[]);
      } catch (e) {
        reject(
          new Error(
            `[FATAL] Failed to parse Python output as JSON: ${lastLine.slice(0, 200)}`
          )
        );
      }
    });

    proc.on("error", err => {
      reject(
        new Error(`[FATAL] Failed to spawn Python process: ${err.message}`)
      );
    });
  });
}

// ─── MAIN EXPORT ──────────────────────────────────────────────────────────────

export async function scrapeAndStoreF5Nrfi(dateStr: string): Promise<{
  processed: number;
  matched: number;
  unmatched: string[];
  errors: string[];
}> {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`[INPUT] mlbF5NrfiScraper.scrapeAndStoreF5Nrfi(date=${dateStr})`);
  console.log(`[INPUT] Source: FanDuel NJ (book_id=69) via Action Network`);
  console.log(`${"=".repeat(70)}`);

  const errors: string[] = [];
  const unmatched: string[] = [];

  // ── Step 1: Query DB for all games on target date ─────────────────────────
  console.log(`\n[STEP 1] Querying DB for MLB games on ${dateStr}`);
  const dbInstance = await getDb();
  const dbGames = await dbInstance
    .select({
      id: games.id,
      awayTeam: games.awayTeam,
      homeTeam: games.homeTeam,
      gameNumber: games.gameNumber,
      mlbGamePk: games.mlbGamePk,
    })
    .from(games)
    .where(and(eq(games.gameDate, dateStr), eq(games.sport, "MLB")));

  console.log(`[STATE] Found ${dbGames.length} MLB games in DB for ${dateStr}`);
  if (dbGames.length === 0) {
    console.log(`[WARN] No games found for ${dateStr}. Aborting.`);
    return { processed: 0, matched: 0, unmatched: [], errors: [] };
  }

  // Build match map: "AWAY@HOME" → array of game records (array for doubleheaders)
  const dbGameMap = new Map<string, typeof dbGames>();
  for (const g of dbGames) {
    const key = makeMatchKey(g.awayTeam ?? "", g.homeTeam ?? "");
    if (!dbGameMap.has(key)) dbGameMap.set(key, []);
    dbGameMap.get(key)!.push(g);
  }
  console.log(`[STATE] DB match map: ${dbGameMap.size} unique matchups`);

  // ── Step 2: Fetch F5/NRFI odds from Action Network ────────────────────────
  console.log(`\n[STEP 2] Fetching F5/NRFI odds from Action Network`);
  let anRecords: AnF5NrfiRecord[];
  try {
    anRecords = await runPythonScraper(dateStr);
    console.log(`[STATE] Received ${anRecords.length} game records from AN`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(msg);
    console.error(`[FATAL] ${msg}`);
    return { processed: 0, matched: 0, unmatched: [], errors };
  }

  // ── Step 3: Match AN records to DB games and write ────────────────────────
  console.log(`\n[STEP 3] Matching AN records to DB games and writing odds`);
  let matched = 0;

  for (const rec of anRecords) {
    const matchKey = makeMatchKey(rec.awayTeam, rec.homeTeam);
    const dbMatches = dbGameMap.get(matchKey);

    if (!dbMatches || dbMatches.length === 0) {
      unmatched.push(
        `${rec.awayTeam}@${rec.homeTeam} (anEventId=${rec.anEventId})`
      );
      console.log(
        `  [WARN] No DB match for ${matchKey} (anEventId=${rec.anEventId})`
      );
      continue;
    }

    // For doubleheaders: use the first unmatched game in the array
    // AN returns them in time order; we process them in order too
    const dbGame = dbMatches.shift()!;

    console.log(
      `  [STEP] Updating game id=${dbGame.id} (${matchKey} G${dbGame.gameNumber ?? 1}) ` +
        `anEventId=${rec.anEventId}`
    );
    console.log(
      `    F5: ML=${rec.f5.awayMlOdds}/${rec.f5.homeMlOdds} ` +
        `RL=${rec.f5.awayRlValue}(${rec.f5.awayRlOdds}) ` +
        `Tot=${rec.f5.totalValue}(o${rec.f5.overOdds}/u${rec.f5.underOdds})`
    );
    console.log(
      `    NRFI: Tot=${rec.nrfi.totalValue} YRFI=${rec.nrfi.overOdds} NRFI=${rec.nrfi.underOdds}`
    );

    try {
      await dbInstance
        .update(games)
        .set({
          // F5 book odds (FanDuel NJ)
          f5AwayML: oddsToString(rec.f5.awayMlOdds),
          f5HomeML: oddsToString(rec.f5.homeMlOdds),
          f5AwayRunLine:
            rec.f5.awayRlValue !== null ? String(rec.f5.awayRlValue) : null,
          f5AwayRunLineOdds: oddsToString(rec.f5.awayRlOdds),
          f5HomeRunLine:
            rec.f5.homeRlValue !== null ? String(rec.f5.homeRlValue) : null,
          f5HomeRunLineOdds: oddsToString(rec.f5.homeRlOdds),
          f5Total:
            rec.f5.totalValue !== null ? String(rec.f5.totalValue) : null,
          f5OverOdds: oddsToString(rec.f5.overOdds),
          f5UnderOdds: oddsToString(rec.f5.underOdds),
          // NRFI/YRFI book odds (FanDuel NJ)
          // nrfiOverOdds = NRFI (under 0.5 runs = "over" the no-run line)
          // yrfiUnderOdds = YRFI (over 0.5 runs = "under" the no-run line)
          nrfiOverOdds: oddsToString(rec.nrfi.underOdds), // NRFI = under 0.5 runs
          yrfiUnderOdds: oddsToString(rec.nrfi.overOdds), // YRFI = over 0.5 runs
        })
        .where(eq(games.id, dbGame.id));

      matched++;
      console.log(`    [VERIFY] PASS — game id=${dbGame.id} updated`);
    } catch (err) {
      const msg = `Failed to update game id=${dbGame.id}: ${err instanceof Error ? err.message : String(err)}`;
      errors.push(msg);
      console.error(`    [VERIFY] FAIL — ${msg}`);
    }
  }

  // ── Step 4: Summary ───────────────────────────────────────────────────────
  console.log(`\n${"=".repeat(70)}`);
  console.log(`[OUTPUT] F5/NRFI Scrape Complete`);
  console.log(`  Total AN records:  ${anRecords.length}`);
  console.log(`  Matched + written: ${matched}`);
  console.log(`  Unmatched:         ${unmatched.length}`);
  console.log(`  Errors:            ${errors.length}`);
  if (unmatched.length > 0) {
    console.log(`  Unmatched games:   ${unmatched.join(", ")}`);
  }
  if (errors.length > 0) {
    console.log(`  Error details:     ${errors.join("; ")}`);
  }
  console.log(
    `[VERIFY] ${errors.length === 0 && unmatched.length === 0 ? "PASS" : "PARTIAL"} — ` +
      `${matched}/${anRecords.length} games written`
  );
  console.log(`${"=".repeat(70)}\n`);

  return { processed: anRecords.length, matched, unmatched, errors };
}
