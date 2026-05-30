/**
 * fetch_pitchers_may30.ts
 * Fetches confirmed starting pitchers from the MLB Stats API for all May 30, 2026 games.
 * Writes awayStartingPitcher + homeStartingPitcher to the games table.
 * Uses: https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-05-30&hydrate=probablePitcher
 */
import { getDb } from "../server/db";
import { games } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";

const TAG = "[PITCHER-FETCH-MAY30]";
const DATE = "2026-05-30";
const MLB_API = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${DATE}&hydrate=probablePitcher(note),team`;

// MLB team abbreviation map — API uses full names, we need 3-letter abbrevs
const TEAM_ABBREV: Record<string, string> = {
  "Arizona Diamondbacks": "ARI",
  "Atlanta Braves": "ATL",
  "Baltimore Orioles": "BAL",
  "Boston Red Sox": "BOS",
  "Chicago Cubs": "CHC",
  "Chicago White Sox": "CWS",
  "Cincinnati Reds": "CIN",
  "Cleveland Guardians": "CLE",
  "Colorado Rockies": "COL",
  "Detroit Tigers": "DET",
  "Houston Astros": "HOU",
  "Kansas City Royals": "KC",
  "Los Angeles Angels": "LAA",
  "Los Angeles Dodgers": "LAD",
  "Miami Marlins": "MIA",
  "Milwaukee Brewers": "MIL",
  "Minnesota Twins": "MIN",
  "New York Mets": "NYM",
  "New York Yankees": "NYY",
  "Oakland Athletics": "ATH",
  "Athletics": "ATH",
  "Philadelphia Phillies": "PHI",
  "Pittsburgh Pirates": "PIT",
  "San Diego Padres": "SD",
  "San Francisco Giants": "SF",
  "Seattle Mariners": "SEA",
  "St. Louis Cardinals": "STL",
  "Tampa Bay Rays": "TB",
  "Texas Rangers": "TEX",
  "Toronto Blue Jays": "TOR",
  "Washington Nationals": "WSH",
};

interface PitcherResult {
  awayTeam: string;
  homeTeam: string;
  awayPitcher: string | null;
  homePitcher: string | null;
  gamePk: number;
}

async function fetchPitchersFromApi(): Promise<PitcherResult[]> {
  console.log(`${TAG} [STEP 1] Fetching from MLB Stats API...`);
  console.log(`${TAG} [INPUT] URL: ${MLB_API}`);

  const res = await fetch(MLB_API);
  if (!res.ok) {
    throw new Error(`MLB API returned ${res.status}: ${res.statusText}`);
  }

  const data = await res.json() as any;
  const dates = data?.dates ?? [];
  if (dates.length === 0) {
    throw new Error(`MLB API returned 0 dates for ${DATE}`);
  }

  const apiGames = dates[0]?.games ?? [];
  console.log(`${TAG} [STATE] API returned ${apiGames.length} games for ${DATE}`);

  const results: PitcherResult[] = [];

  for (const g of apiGames) {
    const gamePk = g.gamePk;
    const awayName = g.teams?.away?.team?.name ?? "";
    const homeName = g.teams?.home?.team?.name ?? "";
    const awayAbbrev = TEAM_ABBREV[awayName] ?? awayName.substring(0, 3).toUpperCase();
    const homeAbbrev = TEAM_ABBREV[homeName] ?? homeName.substring(0, 3).toUpperCase();

    const awayPitcher = g.teams?.away?.probablePitcher?.fullName ?? null;
    const homePitcher = g.teams?.home?.probablePitcher?.fullName ?? null;

    const awayStatus = awayPitcher ? "✅" : "⚠️  NULL";
    const homeStatus = homePitcher ? "✅" : "⚠️  NULL";

    console.log(`${TAG}   [STATE] gamePk=${gamePk} | ${awayAbbrev}@${homeAbbrev}`);
    console.log(`${TAG}     Away SP: ${awayStatus} ${awayPitcher ?? "TBD"}`);
    console.log(`${TAG}     Home SP: ${homeStatus} ${homePitcher ?? "TBD"}`);

    results.push({ awayTeam: awayAbbrev, homeTeam: homeAbbrev, awayPitcher, homePitcher, gamePk });
  }

  return results;
}

async function writePitchersToDb(pitchers: PitcherResult[]): Promise<void> {
  const db = await getDb();
  console.log(`\n${TAG} [STEP 2] Writing pitchers to DB for ${DATE}...`);

  // Get all May 30 games from DB
  const dbGames = await db
    .select({ id: games.id, awayTeam: games.awayTeam, homeTeam: games.homeTeam })
    .from(games)
    .where(and(eq(games.gameDate, DATE), eq(games.sport, "MLB")));

  console.log(`${TAG} [STATE] DB has ${dbGames.length} May 30 MLB games`);

  let written = 0;
  let skipped = 0;
  let notFound = 0;

  for (const p of pitchers) {
    if (!p.awayPitcher && !p.homePitcher) {
      console.log(`${TAG}   ⚠️  SKIP ${p.awayTeam}@${p.homeTeam} — both pitchers null (TBD)`);
      skipped++;
      continue;
    }

    // Match DB game by team abbreviations
    const dbGame = dbGames.find(g =>
      (g.awayTeam === p.awayTeam && g.homeTeam === p.homeTeam) ||
      // Handle edge cases like KC vs KCR
      (g.awayTeam?.startsWith(p.awayTeam.substring(0, 2)) && g.homeTeam?.startsWith(p.homeTeam.substring(0, 2)))
    );

    if (!dbGame) {
      console.log(`${TAG}   ❌ NOT FOUND in DB: ${p.awayTeam}@${p.homeTeam}`);
      // Log all DB games for debugging
      console.log(`${TAG}     DB games: ${dbGames.map(g => `${g.awayTeam}@${g.homeTeam}`).join(", ")}`);
      notFound++;
      continue;
    }

    // Write to DB
    await db
      .update(games)
      .set({
        awayStartingPitcher: p.awayPitcher ?? undefined,
        homeStartingPitcher: p.homePitcher ?? undefined,
        awayPitcherConfirmed: p.awayPitcher != null,
        homePitcherConfirmed: p.homePitcher != null,
      })
      .where(eq(games.id, dbGame.id));

    console.log(`${TAG}   ✅ WRITTEN [${dbGame.id}] ${p.awayTeam}@${p.homeTeam}`);
    console.log(`${TAG}     Away SP: ${p.awayPitcher ?? "NULL"} (confirmed=${p.awayPitcher != null})`);
    console.log(`${TAG}     Home SP: ${p.homePitcher ?? "NULL"} (confirmed=${p.homePitcher != null})`);
    written++;
  }

  console.log(`\n${TAG} [OUTPUT] Written: ${written} | Skipped (TBD): ${skipped} | Not found in DB: ${notFound}`);
}

async function main() {
  console.log(`\n${TAG} ════════════════════════════════════════════════════════════`);
  console.log(`${TAG} MLB Stats API Pitcher Fetch — ${DATE}`);
  console.log(`${TAG} ════════════════════════════════════════════════════════════\n`);

  try {
    const pitchers = await fetchPitchersFromApi();
    await writePitchersToDb(pitchers);

    // Final verification
    const db = await getDb();
    const verify = await db
      .select({
        id: games.id,
        awayTeam: games.awayTeam,
        homeTeam: games.homeTeam,
        awayStartingPitcher: games.awayStartingPitcher,
        homeStartingPitcher: games.homeStartingPitcher,
        awayPitcherConfirmed: games.awayPitcherConfirmed,
        homePitcherConfirmed: games.homePitcherConfirmed,
      })
      .from(games)
      .where(and(eq(games.gameDate, DATE), eq(games.sport, "MLB")));

    console.log(`\n${TAG} [STEP 3] Final DB verification:`);
    let hasPitchers = 0;
    let missingPitchers = 0;
    for (const g of verify) {
      const ok = g.awayStartingPitcher != null && g.homeStartingPitcher != null;
      if (ok) hasPitchers++; else missingPitchers++;
      const status = ok ? "✅" : "⚠️  MISSING";
      console.log(`${TAG}   ${status} [${g.id}] ${g.awayTeam}@${g.homeTeam} | Away=${g.awayStartingPitcher ?? "NULL"}(conf=${g.awayPitcherConfirmed}) | Home=${g.homeStartingPitcher ?? "NULL"}(conf=${g.homePitcherConfirmed})`);
    }

    console.log(`\n${TAG} ════════════════════════════════════════════════════════════`);
    console.log(`${TAG} [VERIFY] Games with pitchers: ${hasPitchers}/15 | Missing: ${missingPitchers}/15`);
    if (missingPitchers > 0) {
      console.log(`${TAG} [VERIFY] ⚠️  ${missingPitchers} games still missing pitchers — TBD starters, model will skip these`);
    } else {
      console.log(`${TAG} [VERIFY] ✅ All 15 games have starting pitchers`);
    }
    console.log(`${TAG} ════════════════════════════════════════════════════════════\n`);

  } catch (e: any) {
    console.error(`${TAG} [ERROR] ${e.message}`);
    console.error(e.stack);
    process.exit(1);
  }

  process.exit(0);
}

main();
