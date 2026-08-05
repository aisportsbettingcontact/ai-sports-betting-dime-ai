/**
 * nhlGoalieWatcher.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Automated goalie change detection cron.
 *
 * Execution flow (every 10 minutes):
 *   1. Fetch all today's upcoming NHL games from the DB
 *   2. Scrape RotoWire starting goalies for today's games
 *   3. For each game, compare scraped goalies vs DB values:
 *        - Goalie name changed (scratch detected)
 *        - Confirmation status improved (projected → confirmed)
 *   4. If any goalie changed:
 *        a. Update awayGoalie / homeGoalie / awayGoalieConfirmed / homeGoalieConfirmed in DB
 *        b. Clear modelRunAt (set to null) so syncNhlModelForToday will re-run the model
 *        c. Call syncNhlModelForToday("auto") to re-run the model immediately
 *   5. Log all changes with timestamps
 *
 * Schedule: every 10 minutes, 9AM-9PM PST (same window as NHL model sync)
 */

import { and, eq } from "drizzle-orm";
import { getDb } from "./db.js";
import { games } from "../drizzle/schema.js";
import type { Game } from "../drizzle/schema.js";
import {
  scrapeNhlStartingGoalies,
  scrapeNhlStartingGoaliesBoth,
} from "./nhlRotoWireScraper.js";
import type { NhlLineupGame } from "./nhlRotoWireScraper.js";
import { syncNhlModelForToday } from "./nhlModelSync.js";
import { NHL_BY_DB_SLUG } from "../shared/nhlTeams.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GoalieChange {
  gameId: number;
  gameLabel: string;
  side: "away" | "home";
  oldGoalie: string | null;
  newGoalie: string | null;
  oldConfirmed: boolean;
  newConfirmed: boolean;
  changeType: "scratch" | "confirmation" | "new";
}

export interface GoalieWatchResult {
  checkedAt: string;
  gamesChecked: number;
  changes: GoalieChange[];
  modelRerun: boolean;
  errors: string[];
}

let lastWatchResult: GoalieWatchResult | null = null;

export function getLastGoalieWatchResult(): GoalieWatchResult | null {
  return lastWatchResult;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getTodayDate(): string {
  const now = new Date();
  const etStr = now.toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [m, d, y] = etStr.split("/");
  return `${y}-${m}-${d}`;
}

function getTomorrowDate(): string {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const etStr = tomorrow.toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [m, d, y] = etStr.split("/");
  return `${y}-${m}-${d}`;
}

function getPSTHour(): number {
  const now = new Date();
  const pstStr = now.toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    hour12: false,
  });
  return parseInt(pstStr, 10);
}

function isWithinWatchWindow(): boolean {
  const h = getPSTHour();
  return h >= 9 && h < 21;
}

/**
 * Normalize a goalie name for comparison.
 * Compares last names to handle "J. Swayman" vs "Jeremy Swayman".
 */
function normalizeGoalieName(name: string | null | undefined): string {
  if (!name) return "";
  const trimmed = name.trim();
  const parts = trimmed.split(/\s+/);
  return parts[parts.length - 1].toLowerCase();
}

/**
 * Check if two goalie names refer to the same player (last-name comparison).
 */
function isSameGoalie(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return normalizeGoalieName(a) === normalizeGoalieName(b);
}

/**
 * Match a scraped RotoWire game to a DB game by team abbreviations.
 * RotoWire returns 3-letter abbrevs (e.g. "BOS"), DB stores dbSlugs (e.g. "boston_bruins").
 * Uses NHL_BY_DB_SLUG to convert dbSlug → abbrev for comparison.
 */
function matchGameToDb(rotoGame: NhlLineupGame, dbGames: Game[]): Game | null {
  const rotoAway = rotoGame.awayTeam.toUpperCase();
  const rotoHome = rotoGame.homeTeam.toUpperCase();

  // Primary match: convert dbSlug → abbrev via NHL_BY_DB_SLUG
  const abbrevMatch = dbGames.find(g => {
    const dbAwayAbbrev =
      NHL_BY_DB_SLUG.get(g.awayTeam ?? "")?.abbrev?.toUpperCase() ?? "";
    const dbHomeAbbrev =
      NHL_BY_DB_SLUG.get(g.homeTeam ?? "")?.abbrev?.toUpperCase() ?? "";
    return dbAwayAbbrev === rotoAway && dbHomeAbbrev === rotoHome;
  });
  if (abbrevMatch) return abbrevMatch;

  // Fallback: direct string match (in case DB stores abbrevs directly)
  const directMatch = dbGames.find(
    g =>
      (g.awayTeam ?? "").toUpperCase() === rotoAway &&
      (g.homeTeam ?? "").toUpperCase() === rotoHome
  );
  return directMatch ?? null;
}

// ─── Core Watch Function ──────────────────────────────────────────────────────

export async function checkGoalieChanges(
  source: "auto" | "manual" = "auto"
): Promise<GoalieWatchResult> {
  const tag = source === "manual" ? "[MANUAL]" : "[AUTO]";
  const checkedAt = new Date().toISOString();

  console.log(`\n[GoalieWatcher]${tag} START - ${checkedAt}`);

  const result: GoalieWatchResult = {
    checkedAt,
    gamesChecked: 0,
    changes: [],
    modelRerun: false,
    errors: [],
  };

  // Step 1: Get today's upcoming NHL games from DB
  const gameDate = getTodayDate();
  let db: Awaited<ReturnType<typeof getDb>>;
  try {
    db = await getDb();
    if (!db) {
      result.errors.push("Database not available");
      lastWatchResult = result;
      return result;
    }
  } catch (err) {
    result.errors.push(`DB connection error: ${err}`);
    lastWatchResult = result;
    return result;
  }

  const todayGames = await db
    .select()
    .from(games)
    .where(
      and(
        eq(games.gameDate, gameDate),
        eq(games.sport, "NHL")
        // Process ALL games (upcoming, live, final) — goalie data should be tracked for every game
      )
    );

  result.gamesChecked = todayGames.length;
  console.log(
    `[GoalieWatcher]${tag}   Found ${todayGames.length} NHL games for ${gameDate} (all statuses)`
  );

  if (todayGames.length === 0) {
    console.log(`[GoalieWatcher]${tag} No NHL games today`);
    lastWatchResult = result;
    return result;
  }

  // Step 2: Scrape RotoWire starting goalies
  let rotoGames: NhlLineupGame[] = [];
  try {
    rotoGames = await scrapeNhlStartingGoalies();
    console.log(
      `[GoalieWatcher]${tag}   RotoWire returned ${rotoGames.length} games`
    );
  } catch (err) {
    const msg = `RotoWire scrape failed: ${err}`;
    console.error(`[GoalieWatcher]${tag} ${msg}`);
    result.errors.push(msg);
    lastWatchResult = result;
    return result;
  }

  if (rotoGames.length === 0) {
    console.warn(
      `[GoalieWatcher]${tag} RotoWire returned 0 games - page may not have today's lineups yet`
    );
    lastWatchResult = result;
    return result;
  }

  // Step 3: Compare scraped goalies vs DB
  // ── Structured per-game Rotowire goalie log ─────────────────────────────
  // Emits one line per game: matchup, away/home goalie name + confirmed status
  for (const rg of rotoGames) {
    const awayG = rg.awayGoalie
      ? `${rg.awayGoalie.name}${rg.awayGoalie.confirmed ? " [CONFIRMED]" : " [EXPECTED]"}`
      : "TBD";
    const homeG = rg.homeGoalie
      ? `${rg.homeGoalie.name}${rg.homeGoalie.confirmed ? " [CONFIRMED]" : " [EXPECTED]"}`
      : "TBD";
    console.log(
      `[GoalieWatcher]${tag}[Roto][TODAY] ${rg.awayTeam}@${rg.homeTeam} | away_g=${awayG} home_g=${homeG}`
    );
  }
  const changedGameIds: number[] = [];
  const newlyPopulatedGameIds: number[] = []; // games where both goalies just became available

  for (const rotoGame of rotoGames) {
    const dbGame = matchGameToDb(rotoGame, todayGames);
    if (!dbGame) {
      console.log(
        `[GoalieWatcher]${tag}   No DB match for: ${rotoGame.awayTeam} @ ${rotoGame.homeTeam}`
      );
      continue;
    }

    const gameLabel = `${dbGame.awayTeam} @ ${dbGame.homeTeam}`;
    const gameChanges: GoalieChange[] = [];

    // Check away goalie
    if (rotoGame.awayGoalie) {
      const rotoName = rotoGame.awayGoalie.name;
      const rotoConfirmed = rotoGame.awayGoalie.confirmed;
      const dbName = dbGame.awayGoalie;
      const dbConfirmed = dbGame.awayGoalieConfirmed ?? false;

      const nameChanged = !isSameGoalie(dbName, rotoName);
      const confirmationImproved = !dbConfirmed && rotoConfirmed;

      if (nameChanged || confirmationImproved) {
        const changeType: GoalieChange["changeType"] = !dbName
          ? "new"
          : nameChanged
            ? "scratch"
            : "confirmation";
        gameChanges.push({
          gameId: dbGame.id,
          gameLabel,
          side: "away",
          oldGoalie: dbName ?? null,
          newGoalie: rotoName,
          oldConfirmed: dbConfirmed,
          newConfirmed: rotoConfirmed,
          changeType,
        });
        console.log(
          `[GoalieWatcher]${tag}   AWAY [${changeType.toUpperCase()}] ${gameLabel}: "${dbName ?? "TBD"}" -> "${rotoName}" (${rotoConfirmed ? "confirmed" : "projected"})`
        );
      }
    }

    // Check home goalie
    if (rotoGame.homeGoalie) {
      const rotoName = rotoGame.homeGoalie.name;
      const rotoConfirmed = rotoGame.homeGoalie.confirmed;
      const dbName = dbGame.homeGoalie;
      const dbConfirmed = dbGame.homeGoalieConfirmed ?? false;

      const nameChanged = !isSameGoalie(dbName, rotoName);
      const confirmationImproved = !dbConfirmed && rotoConfirmed;

      if (nameChanged || confirmationImproved) {
        const changeType: GoalieChange["changeType"] = !dbName
          ? "new"
          : nameChanged
            ? "scratch"
            : "confirmation";
        gameChanges.push({
          gameId: dbGame.id,
          gameLabel,
          side: "home",
          oldGoalie: dbName ?? null,
          newGoalie: rotoName,
          oldConfirmed: dbConfirmed,
          newConfirmed: rotoConfirmed,
          changeType,
        });
        console.log(
          `[GoalieWatcher]${tag}   HOME [${changeType.toUpperCase()}] ${gameLabel}: "${dbName ?? "TBD"}" -> "${rotoName}" (${rotoConfirmed ? "confirmed" : "projected"})`
        );
      }
    }

    if (gameChanges.length > 0) {
      result.changes.push(...gameChanges);

      // Build DB update payload
      const updatePayload: Record<string, unknown> = {};
      for (const change of gameChanges) {
        if (change.side === "away") {
          updatePayload.awayGoalie = change.newGoalie;
          updatePayload.awayGoalieConfirmed = change.newConfirmed;
        } else {
          updatePayload.homeGoalie = change.newGoalie;
          updatePayload.homeGoalieConfirmed = change.newConfirmed;
        }
      }

      // Only clear modelRunAt and queue model re-run for upcoming games
      // (live/final games have already started — no point re-running model)
      if (dbGame.gameStatus === "upcoming") {
        changedGameIds.push(dbGame.id);
        updatePayload.modelRunAt = null;
        console.log(
          `[GoalieWatcher]${tag}   Clearing modelRunAt for ${gameLabel} - model will re-run`
        );
      } else {
        console.log(
          `[GoalieWatcher]${tag}   Goalie updated for ${gameLabel} (${dbGame.gameStatus}) - no model re-run needed`
        );
      }

      try {
        await db
          .update(games)
          .set(updatePayload)
          .where(eq(games.id, dbGame.id));
        console.log(`[GoalieWatcher]${tag}   DB updated for ${gameLabel}`);
      } catch (err) {
        const msg = `DB update failed for ${gameLabel}: ${err}`;
        console.error(`[GoalieWatcher]${tag} ${msg}`);
        result.errors.push(msg);
      }
    } else {
      // Silently populate missing goalie data
      const awayMissing = !dbGame.awayGoalie && rotoGame.awayGoalie;
      const homeMissing = !dbGame.homeGoalie && rotoGame.homeGoalie;
      if (awayMissing || homeMissing) {
        const silentUpdate: Record<string, unknown> = {};
        if (awayMissing && rotoGame.awayGoalie) {
          silentUpdate.awayGoalie = rotoGame.awayGoalie.name;
          silentUpdate.awayGoalieConfirmed = rotoGame.awayGoalie.confirmed;
        }
        if (homeMissing && rotoGame.homeGoalie) {
          silentUpdate.homeGoalie = rotoGame.homeGoalie.name;
          silentUpdate.homeGoalieConfirmed = rotoGame.homeGoalie.confirmed;
        }

        // Check if BOTH goalies are now available after this update
        // Only trigger model run for upcoming games (live/final already started)
        const awayGoalieAfter =
          awayMissing && rotoGame.awayGoalie
            ? rotoGame.awayGoalie.name
            : dbGame.awayGoalie;
        const homeGoalieAfter =
          homeMissing && rotoGame.homeGoalie
            ? rotoGame.homeGoalie.name
            : dbGame.homeGoalie;
        const bothGoaliesNowAvailable = !!awayGoalieAfter && !!homeGoalieAfter;
        const modelNotYetRun = !dbGame.modelRunAt;
        const isUpcoming = dbGame.gameStatus === "upcoming";

        if (bothGoaliesNowAvailable && modelNotYetRun && isUpcoming) {
          // Clear modelRunAt to ensure model runs (it may already be null)
          silentUpdate.modelRunAt = null;
          newlyPopulatedGameIds.push(dbGame.id);
          console.log(
            `[GoalieWatcher]${tag}   BOTH goalies now available for ${gameLabel} - queuing model run`
          );
        }

        try {
          await db
            .update(games)
            .set(silentUpdate)
            .where(eq(games.id, dbGame.id));
          console.log(
            `[GoalieWatcher]${tag}   Silent goalie populate for ${gameLabel}: away=${awayGoalieAfter ?? "TBD"} home=${homeGoalieAfter ?? "TBD"}`
          );
        } catch (err) {
          console.warn(
            `[GoalieWatcher]${tag} Silent goalie update failed for ${gameLabel}: ${err}`
          );
        }
      } else {
        // CASE C/D FIX: Both goalies already in DB, no change detected this cycle.
        // If modelRunAt is still null (model never ran for this game), queue it.
        // This handles the stale-hash scenario: goalies seeded in a prior cycle,
        // watcher restarted, no change fires → model would never run without this path.
        const bothAlreadyPresent = !!dbGame.awayGoalie && !!dbGame.homeGoalie;
        const modelStillNull = !dbGame.modelRunAt;
        const isUpcomingGame = dbGame.gameStatus === "upcoming";
        if (bothAlreadyPresent && modelStillNull && isUpcomingGame) {
          newlyPopulatedGameIds.push(dbGame.id);
          console.log(
            `[GoalieWatcher]${tag}   FALLBACK: ${gameLabel} — both goalies present, modelRunAt=null → queuing model run` +
              ` | away=${dbGame.awayGoalie} home=${dbGame.homeGoalie}`
          );
        } else {
          console.log(
            `[GoalieWatcher]${tag}   No changes for ${gameLabel}` +
              ` | bothPresent=${bothAlreadyPresent} modelNull=${modelStillNull} upcoming=${isUpcomingGame}`
          );
        }
      }
    }
  }

  // Step 4: Re-run model for games with goalie changes OR newly populated goalies
  // Includes CASE C/D fallback: games where both goalies already present but modelRunAt=null
  const allGameIdsToRerun = Array.from(
    new Set([...changedGameIds, ...newlyPopulatedGameIds])
  );

  if (allGameIdsToRerun.length > 0) {
    console.log(
      `\n[GoalieWatcher]${tag} Triggering model for ${allGameIdsToRerun.length} game(s)` +
        ` (${changedGameIds.length} changed + ${newlyPopulatedGameIds.length} newly populated / fallback)...`
    );
    try {
      const syncResult = await syncNhlModelForToday("auto");
      result.modelRerun = true;
      console.log(
        `[GoalieWatcher]${tag} Model run complete:` +
          ` synced=${syncResult.synced} skipped=${syncResult.skipped} errors=${syncResult.errors.length}`
      );
    } catch (err) {
      const msg = `Model run failed: ${err}`;
      console.error(`[GoalieWatcher]${tag} ${msg}`);
      result.errors.push(msg);
    }
  } else {
    console.log(
      `[GoalieWatcher]${tag} No goalie changes, new populations, or fallback games — model not re-run`
    );
  }

  console.log(
    `[GoalieWatcher]${tag} DONE - changes=${result.changes.length} modelRerun=${result.modelRerun} errors=${result.errors.length}`
  );
  lastWatchResult = result;
  return result;
}

// ─── Tomorrow Seeder ─────────────────────────────────────────────────────────

/**
 * Seed tomorrow's NHL games with initial goalie data from RotoWire.
 * Runs every evening (6PM–9PM PST) to populate tomorrow's games a day in advance.
 * Triggers the model for any tomorrow game that has both goalies populated.
 */
export async function seedNhlTomorrowGoalies(
  source: "auto" | "manual" = "auto"
): Promise<GoalieWatchResult> {
  const tag = source === "manual" ? "[MANUAL]" : "[AUTO]";
  const checkedAt = new Date().toISOString();
  console.log(`\n[GoalieTomorrowSeeder]${tag} START - ${checkedAt}`);

  const result: GoalieWatchResult = {
    checkedAt,
    gamesChecked: 0,
    changes: [],
    modelRerun: false,
    errors: [],
  };

  const tomorrowDate = getTomorrowDate();

  // Step 1: Get tomorrow's NHL games from DB
  let db: Awaited<ReturnType<typeof getDb>>;
  try {
    db = await getDb();
    if (!db) {
      result.errors.push("Database not available");
      return result;
    }
  } catch (err) {
    result.errors.push(`DB connection error: ${err}`);
    return result;
  }

  const tomorrowGames = await db
    .select()
    .from(games)
    .where(and(eq(games.gameDate, tomorrowDate), eq(games.sport, "NHL")));

  result.gamesChecked = tomorrowGames.length;
  console.log(
    `[GoalieTomorrowSeeder]${tag}   Found ${tomorrowGames.length} NHL games for ${tomorrowDate}`
  );

  if (tomorrowGames.length === 0) {
    console.log(
      `[GoalieTomorrowSeeder]${tag}   No NHL games tomorrow (${tomorrowDate}) - nothing to seed`
    );
    return result;
  }

  // Step 2: Scrape RotoWire tomorrow lineups
  let rotoGames: NhlLineupGame[] = [];
  try {
    rotoGames = await scrapeNhlStartingGoalies("tomorrow");
    console.log(
      `[GoalieTomorrowSeeder]${tag}   RotoWire TOMORROW returned ${rotoGames.length} games`
    );
  } catch (err) {
    const msg = `RotoWire tomorrow scrape failed: ${err}`;
    console.error(`[GoalieTomorrowSeeder]${tag} ${msg}`);
    result.errors.push(msg);
    return result;
  }

  if (rotoGames.length === 0) {
    console.warn(
      `[GoalieTomorrowSeeder]${tag}   RotoWire returned 0 tomorrow games - lineups not yet posted`
    );
    return result;
  }

  // Step 3: Seed / update goalies for each tomorrow game
  // ── Structured per-game Rotowire goalie log (TOMORROW) ─────────────────────────────
  for (const rg of rotoGames) {
    const awayG = rg.awayGoalie
      ? `${rg.awayGoalie.name}${rg.awayGoalie.confirmed ? " [CONFIRMED]" : " [EXPECTED]"}`
      : "TBD";
    const homeG = rg.homeGoalie
      ? `${rg.homeGoalie.name}${rg.homeGoalie.confirmed ? " [CONFIRMED]" : " [EXPECTED]"}`
      : "TBD";
    console.log(
      `[GoalieTomorrowSeeder]${tag}[Roto][TOMORROW] ${rg.awayTeam}@${rg.homeTeam} | away_g=${awayG} home_g=${homeG}`
    );
  }
  const gameIdsToModel: number[] = [];

  for (const rotoGame of rotoGames) {
    const dbGame = matchGameToDb(rotoGame, tomorrowGames);
    if (!dbGame) {
      console.log(
        `[GoalieTomorrowSeeder]${tag}   No DB match for: ${rotoGame.awayTeam} @ ${rotoGame.homeTeam}`
      );
      continue;
    }

    const gameLabel = `${dbGame.awayTeam} @ ${dbGame.homeTeam}`;
    const updatePayload: Record<string, unknown> = {};
    let hasChange = false;

    if (rotoGame.awayGoalie) {
      const nameChanged = !isSameGoalie(
        dbGame.awayGoalie,
        rotoGame.awayGoalie.name
      );
      const confirmImproved =
        !dbGame.awayGoalieConfirmed && rotoGame.awayGoalie.confirmed;
      const isMissing = !dbGame.awayGoalie;
      if (isMissing || nameChanged || confirmImproved) {
        const changeType = isMissing
          ? "NEW"
          : nameChanged
            ? "SCRATCH"
            : "CONFIRMED";
        console.log(
          `[GoalieTomorrowSeeder]${tag}   AWAY [${changeType}] ${gameLabel}: "${dbGame.awayGoalie ?? "TBD"}" -> "${rotoGame.awayGoalie.name}" (${rotoGame.awayGoalie.confirmed ? "confirmed" : "expected"})`
        );
        updatePayload.awayGoalie = rotoGame.awayGoalie.name;
        updatePayload.awayGoalieConfirmed = rotoGame.awayGoalie.confirmed;
        hasChange = true;
        result.changes.push({
          gameId: dbGame.id,
          gameLabel,
          side: "away",
          oldGoalie: dbGame.awayGoalie ?? null,
          newGoalie: rotoGame.awayGoalie.name,
          oldConfirmed: dbGame.awayGoalieConfirmed ?? false,
          newConfirmed: rotoGame.awayGoalie.confirmed,
          changeType: isMissing
            ? "new"
            : nameChanged
              ? "scratch"
              : "confirmation",
        });
      }
    }

    if (rotoGame.homeGoalie) {
      const nameChanged = !isSameGoalie(
        dbGame.homeGoalie,
        rotoGame.homeGoalie.name
      );
      const confirmImproved =
        !dbGame.homeGoalieConfirmed && rotoGame.homeGoalie.confirmed;
      const isMissing = !dbGame.homeGoalie;
      if (isMissing || nameChanged || confirmImproved) {
        const changeType = isMissing
          ? "NEW"
          : nameChanged
            ? "SCRATCH"
            : "CONFIRMED";
        console.log(
          `[GoalieTomorrowSeeder]${tag}   HOME [${changeType}] ${gameLabel}: "${dbGame.homeGoalie ?? "TBD"}" -> "${rotoGame.homeGoalie.name}" (${rotoGame.homeGoalie.confirmed ? "confirmed" : "expected"})`
        );
        updatePayload.homeGoalie = rotoGame.homeGoalie.name;
        updatePayload.homeGoalieConfirmed = rotoGame.homeGoalie.confirmed;
        hasChange = true;
        result.changes.push({
          gameId: dbGame.id,
          gameLabel,
          side: "home",
          oldGoalie: dbGame.homeGoalie ?? null,
          newGoalie: rotoGame.homeGoalie.name,
          oldConfirmed: dbGame.homeGoalieConfirmed ?? false,
          newConfirmed: rotoGame.homeGoalie.confirmed,
          changeType: isMissing
            ? "new"
            : nameChanged
              ? "scratch"
              : "confirmation",
        });
      }
    }

    if (hasChange) {
      // Check if both goalies will be available after this update
      const awayAfter =
        (updatePayload.awayGoalie as string | undefined) ?? dbGame.awayGoalie;
      const homeAfter =
        (updatePayload.homeGoalie as string | undefined) ?? dbGame.homeGoalie;
      const bothAvailable = !!awayAfter && !!homeAfter;
      const modelNotRun = !dbGame.modelRunAt;

      if (bothAvailable && modelNotRun) {
        updatePayload.modelRunAt = null; // ensure cleared for model run
        gameIdsToModel.push(dbGame.id);
        console.log(
          `[GoalieTomorrowSeeder]${tag}   Both goalies available for ${gameLabel} — queuing model run`
        );
      }

      try {
        await db
          .update(games)
          .set(updatePayload)
          .where(eq(games.id, dbGame.id));
        console.log(`[GoalieTomorrowSeeder]${tag}   DB updated: ${gameLabel}`);
      } catch (err) {
        const msg = `DB update failed for ${gameLabel}: ${err}`;
        console.error(`[GoalieTomorrowSeeder]${tag} ${msg}`);
        result.errors.push(msg);
      }
    } else {
      console.log(
        `[GoalieTomorrowSeeder]${tag}   No changes for ${gameLabel} (goalies already current)`
      );
    }
  }

  // Step 4: Run model for tomorrow's games that now have both goalies
  // ── Fallback pass: catch games already populated but never modeled ──────────
  // If goalies were seeded in a prior cycle (no change this cycle), gameIdsToModel
  // will be empty even though modelRunAt IS NULL. Query DB directly to catch them.
  const alreadyPopulatedUnmodeled = tomorrowGames.filter(
    (g: (typeof tomorrowGames)[0]) =>
      !!g.awayGoalie && !!g.homeGoalie && !g.modelRunAt
  );
  const alreadyPopulatedIds = alreadyPopulatedUnmodeled
    .map((g: (typeof tomorrowGames)[0]) => g.id)
    .filter((id: number) => !gameIdsToModel.includes(id));
  if (alreadyPopulatedIds.length > 0) {
    console.log(
      `[GoalieTomorrowSeeder]${tag} Fallback: ${alreadyPopulatedIds.length} tomorrow game(s) have both goalies but modelRunAt=null — queuing model run`
    );
    for (const g of alreadyPopulatedUnmodeled) {
      if (!gameIdsToModel.includes(g.id)) {
        console.log(
          `[GoalieTomorrowSeeder]${tag}   → ${g.awayTeam} @ ${g.homeTeam} | away=${g.awayGoalie} home=${g.homeGoalie}`
        );
      }
    }
  }
  const allGameIdsToModel = Array.from(
    new Set([...gameIdsToModel, ...alreadyPopulatedIds])
  );
  if (allGameIdsToModel.length > 0) {
    console.log(
      `\n[GoalieTomorrowSeeder]${tag} Triggering model for ${allGameIdsToModel.length} tomorrow game(s) (${gameIdsToModel.length} changed + ${alreadyPopulatedIds.length} fallback)...`
    );
    try {
      const syncResult = await syncNhlModelForToday(
        "auto",
        false,
        false,
        tomorrowDate
      );
      result.modelRerun = true;
      console.log(
        `[GoalieTomorrowSeeder]${tag} Model run complete: synced=${syncResult.synced} skipped=${syncResult.skipped} errors=${syncResult.errors.length}`
      );
    } catch (err) {
      const msg = `Model run failed for tomorrow: ${err}`;
      console.error(`[GoalieTomorrowSeeder]${tag} ${msg}`);
      result.errors.push(msg);
    }
  } else {
    console.log(
      `[GoalieTomorrowSeeder]${tag} No games to model — all tomorrow games already modeled or missing goalies`
    );
  }

  console.log(
    `[GoalieTomorrowSeeder]${tag} DONE - changes=${result.changes.length} modelRerun=${result.modelRerun} errors=${result.errors.length}`
  );
  return result;
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

let watcherIntervalId: ReturnType<typeof setInterval> | null = null;
let tomorrowSeederIntervalId: ReturnType<typeof setInterval> | null = null;

export function startNhlGoalieWatcher(): void {
  if (watcherIntervalId) {
    console.log("[GoalieWatcher] Already running - skipping duplicate start");
    return;
  }

  console.log(
    "[GoalieWatcher] Starting 5-minute goalie change watcher (today + tomorrow) — 24/7, no time gates"
  );

  // ── TODAY WATCHER: runs every 5 min, 24/7 ────────────────────────────────
  checkGoalieChanges("auto").catch(err => {
    console.error("[GoalieWatcher] Initial today-run error:", err);
  });

  watcherIntervalId = setInterval(
    () => {
      checkGoalieChanges("auto").catch(err => {
        console.error("[GoalieWatcher] Interval run error:", err);
      });
    },
    5 * 60 * 1000
  );

  // ── TOMORROW SEEDER: runs every 5 min, 24/7 ────────────────────────────────
  // Seeds tomorrow's games with initial goalie data and runs the model day-ahead.
  // 24/7 — RotoWire posts next-day lineups at any time; we catch them immediately.
  const runTomorrowSeeder = () => {
    console.log(`[GoalieTomorrowSeeder] [AUTO] Scheduled 5-min run`);
    seedNhlTomorrowGoalies("auto").catch(err => {
      console.error("[GoalieTomorrowSeeder] Scheduled run error:", err);
    });
  };

  // Run immediately on startup
  runTomorrowSeeder();

  tomorrowSeederIntervalId = setInterval(runTomorrowSeeder, 5 * 60 * 1000);

  console.log("[GoalieWatcher] TODAY watcher: every 5 min (24/7)");
  console.log("[GoalieTomorrowSeeder] TOMORROW seeder: every 5 min (24/7)");
}

// Dead export — no active callers in pipeline
function stopNhlGoalieWatcher(): void {
  if (watcherIntervalId) {
    clearInterval(watcherIntervalId);
    watcherIntervalId = null;
    console.log("[GoalieWatcher] Stopped");
  }
}
