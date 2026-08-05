/**
 * kPropsDbHelpers.ts
 *
 * Helper functions for upserting mlb_strikeout_props rows with live AN line data.
 * Called by MLBCycle every 10 minutes to keep book lines fresh.
 *
 * upsertKPropsFromAN (PRIMARY):
 *   - Matches each AN prop to a DB game by awayTeam/homeTeam + gameDate
 *   - Determines side (away/home) based on which team the pitcher belongs to
 *   - Inserts new rows if none exist, updates existing rows with latest book lines
 *   - This is the primary seeder for K-Props (no StrikeoutModel.py required)
 *
 * updateKPropsFromAN (LEGACY):
 *   - Only updates existing rows — does NOT insert new ones
 *   - Kept for backward compatibility with the 10-min automation cycle
 *
 * Logging format:
 *   [KPropsDB][STEP]   operation description
 *   [KPropsDB][STATE]  intermediate state
 *   [KPropsDB][OUTPUT] result
 *   [KPropsDB][WARN]   non-fatal warning
 *   [KPropsDB][ERROR]  fatal error
 */

import { getDb } from "./db";
import { mlbStrikeoutProps, games } from "../drizzle/schema";
import { eq, and, inArray } from "drizzle-orm";
import type { ANKPropsResult, ANKPropLine } from "./anKPropsService";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UpdateKPropsResult {
  updated: number;
  notFound: number;
  errors: number;
  details: Array<{
    pitcherName: string;
    anLine: number;
    matched: boolean;
    matchType?: "exact" | "lastName";
  }>;
}

export interface UpsertKPropsResult {
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
  details: Array<{
    pitcherName: string;
    teamAbbr: string;
    side: string;
    gameId: number;
    anLine: number;
    action: "inserted" | "updated" | "skipped" | "error";
    reason?: string;
  }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z\s]/g, "");
}

function getLastName(name: string): string {
  const parts = normalizeName(name).split(/\s+/);
  return parts[parts.length - 1];
}

// AN team abbreviations → DB team abbreviations mapping
// AN uses standard MLB abbreviations; our DB uses the same format
// Only special cases need mapping
const AN_TO_DB_TEAM: Record<string, string> = {
  // AN uses these, DB uses these (most are identical)
  // Add overrides here if needed
  WSH: "WSH",
  CWS: "CWS",
  KC: "KC",
  TB: "TB",
  SF: "SF",
  SD: "SD",
  LAD: "LAD",
  LAA: "LAA",
  NYY: "NYY",
  NYM: "NYM",
};

function mapTeamAbbr(anAbbr: string): string {
  return AN_TO_DB_TEAM[anAbbr] ?? anAbbr;
}

// ── Primary export: upsertKPropsFromAN ────────────────────────────────────────

/**
 * Upsert mlb_strikeout_props rows from AN K-prop lines.
 *
 * For each AN prop:
 *   1. Find the matching DB game by awayTeam/homeTeam + gameDate
 *   2. Determine side (away/home) based on pitcher's team
 *   3. Insert new row if none exists, update existing row with latest book lines
 *
 * This is the primary seeder — no StrikeoutModel.py required.
 * Model fields (kProj, kLine, etc.) are left null on insert; they get populated
 * when StrikeoutModel.py runs later.
 */
export async function upsertKPropsFromAN(
  anResult: ANKPropsResult,
  gameDate: string
): Promise<UpsertKPropsResult> {
  const TAG = "[KPropsDB]";
  console.log(
    `${TAG}[STEP] upsertKPropsFromAN: date=${gameDate} | ${anResult.props.length} AN props`
  );

  const db = await getDb();

  // ── Step 1: Load all DB games for this date ──────────────────────────────
  const dbGames = await db
    .select({
      id: games.id,
      awayTeam: games.awayTeam,
      homeTeam: games.homeTeam,
    })
    .from(games)
    .where(and(eq(games.gameDate, gameDate), eq(games.sport, "MLB")));

  console.log(
    `${TAG}[STATE] Found ${dbGames.length} MLB games in DB for ${gameDate}`
  );

  // Build lookup: "AWAY@HOME" → game row
  const gameByMatchup = new Map<
    string,
    { id: number; awayTeam: string; homeTeam: string }
  >();
  for (const g of dbGames as Array<{
    id: number;
    awayTeam: string;
    homeTeam: string;
  }>) {
    gameByMatchup.set(`${g.awayTeam}@${g.homeTeam}`, g);
  }

  // ── Step 2: Load existing K-Props rows for this date ────────────────────
  const gameIds = (
    dbGames as Array<{ id: number; awayTeam: string; homeTeam: string }>
  ).map(g => g.id);
  const existingRows =
    gameIds.length > 0
      ? await db
          .select({
            id: mlbStrikeoutProps.id,
            gameId: mlbStrikeoutProps.gameId,
            side: mlbStrikeoutProps.side,
            pitcherName: mlbStrikeoutProps.pitcherName,
          })
          .from(mlbStrikeoutProps)
          .where(inArray(mlbStrikeoutProps.gameId, gameIds))
      : [];

  console.log(
    `${TAG}[STATE] Found ${existingRows.length} existing K-Props rows`
  );

  // Build lookup: "gameId:side" → existing row
  const existingByKey = new Map<string, (typeof existingRows)[0]>();
  for (const row of existingRows) {
    existingByKey.set(`${row.gameId}:${row.side}`, row);
  }

  // ── Step 3: Process each AN prop ────────────────────────────────────────
  const result: UpsertKPropsResult = {
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    details: [],
  };

  // Deduplicate: one entry per pitcher (AN may have separate OVER/UNDER rows)
  const processedPitchers = new Set<string>();

  for (const anProp of anResult.props) {
    const anNameNorm = normalizeName(anProp.pitcherName);
    if (processedPitchers.has(anNameNorm)) continue;
    processedPitchers.add(anNameNorm);

    const dbTeam = mapTeamAbbr(anProp.teamAbbr);

    // Find the matching DB game: pitcher's team is either away or home
    let matchedGame: (typeof dbGames)[0] | undefined;
    let side: "away" | "home" | undefined;

    for (const g of dbGames as Array<{
      id: number;
      awayTeam: string;
      homeTeam: string;
    }>) {
      if (g.awayTeam === dbTeam) {
        matchedGame = g;
        side = "away";
        break;
      }
      if (g.homeTeam === dbTeam) {
        matchedGame = g;
        side = "home";
        break;
      }
    }

    if (!matchedGame || !side) {
      console.log(
        `${TAG}[WARN] No DB game found for AN pitcher: ${anProp.pitcherName} (team: ${anProp.teamAbbr} → ${dbTeam})`
      );
      result.skipped++;
      result.details.push({
        pitcherName: anProp.pitcherName,
        teamAbbr: anProp.teamAbbr,
        side: "unknown",
        gameId: 0,
        anLine: anProp.line,
        action: "skipped",
        reason: `No DB game found for team ${dbTeam}`,
      });
      continue;
    }

    const key = `${matchedGame.id}:${side}`;
    const existingRow = existingByKey.get(key);

    const bookLine = anProp.line !== null ? String(anProp.line) : null;
    const bookOverOdds =
      anProp.overOdds !== null ? String(Math.round(anProp.overOdds)) : null;
    const bookUnderOdds =
      anProp.underOdds !== null ? String(Math.round(anProp.underOdds)) : null;
    const anNoVigOverPct =
      anProp.noVigOverPct !== null ? anProp.noVigOverPct.toFixed(4) : null;
    const anPlayerId =
      anProp.anPlayerId !== null ? Number(anProp.anPlayerId) : null;

    try {
      if (existingRow) {
        // UPDATE existing row — only update book line fields, preserve model data
        await db
          .update(mlbStrikeoutProps)
          .set({
            pitcherName: anProp.pitcherName, // refresh name from AN
            bookLine,
            bookOverOdds,
            bookUnderOdds,
            anNoVigOverPct,
            anPlayerId,
          })
          .where(eq(mlbStrikeoutProps.id, existingRow.id));

        result.updated++;
        console.log(
          `${TAG}[OUTPUT] UPDATED ${anProp.pitcherName} (${side}) | gameId=${matchedGame.id} | line=${anProp.line} | over=${bookOverOdds} | under=${bookUnderOdds} | noVig=${anNoVigOverPct}`
        );
        result.details.push({
          pitcherName: anProp.pitcherName,
          teamAbbr: anProp.teamAbbr,
          side,
          gameId: matchedGame.id,
          anLine: anProp.line,
          action: "updated",
        });
      } else {
        // INSERT new row — book lines from AN, model fields null (populated later by StrikeoutModel.py)
        await db.insert(mlbStrikeoutProps).values({
          gameId: matchedGame.id,
          side,
          pitcherName: anProp.pitcherName,
          bookLine,
          bookOverOdds,
          bookUnderOdds,
          anNoVigOverPct,
          anPlayerId,
        });

        result.inserted++;
        console.log(
          `${TAG}[OUTPUT] INSERTED ${anProp.pitcherName} (${side}) | gameId=${matchedGame.id} | line=${anProp.line} | over=${bookOverOdds} | under=${bookUnderOdds} | noVig=${anNoVigOverPct}`
        );
        result.details.push({
          pitcherName: anProp.pitcherName,
          teamAbbr: anProp.teamAbbr,
          side,
          gameId: matchedGame.id,
          anLine: anProp.line,
          action: "inserted",
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const cause = (err as { cause?: unknown })?.cause;
      const causeMsg =
        cause instanceof Error ? ` | cause: ${cause.message}` : "";
      console.error(
        `${TAG}[ERROR] Failed to upsert ${anProp.pitcherName} (${side}): ${msg}${causeMsg}`
      );
      result.errors++;
      result.details.push({
        pitcherName: anProp.pitcherName,
        teamAbbr: anProp.teamAbbr,
        side: side ?? "unknown",
        gameId: matchedGame?.id ?? 0,
        anLine: anProp.line,
        action: "error",
        reason: msg,
      });
    }
  }

  console.log(
    `${TAG}[OUTPUT] upsertKPropsFromAN complete: inserted=${result.inserted} updated=${result.updated} skipped=${result.skipped} errors=${result.errors}`
  );
  return result;
}

// ── Legacy export: updateKPropsFromAN ─────────────────────────────────────────

/**
 * Update mlb_strikeout_props rows with live AN line data.
 * Matches by pitcherName (case-insensitive) within the given gameDate.
 * ONLY updates existing rows — does NOT insert new ones.
 * Use upsertKPropsFromAN for full insert+update behavior.
 */
export async function updateKPropsFromAN(
  anResult: ANKPropsResult,
  gameDate: string
): Promise<UpdateKPropsResult> {
  console.log(
    `[KPropsDB][STEP] Updating K-props from AN for date=${gameDate} | ${anResult.props.length} AN props`
  );

  const db = await getDb();

  // Fetch all K-prop rows for this date
  const existingRows = await db
    .select({
      id: mlbStrikeoutProps.id,
      pitcherName: mlbStrikeoutProps.pitcherName,
      side: mlbStrikeoutProps.side,
      gameId: mlbStrikeoutProps.gameId,
    })
    .from(mlbStrikeoutProps)
    .innerJoin(games, eq(mlbStrikeoutProps.gameId, games.id))
    .where(eq(games.gameDate, gameDate));

  console.log(
    `[KPropsDB][STATE] Found ${existingRows.length} K-prop rows in DB for ${gameDate}`
  );

  const result: UpdateKPropsResult = {
    updated: 0,
    notFound: 0,
    errors: 0,
    details: [],
  };

  // Build a map of existing rows by normalized pitcher name
  const rowsByName = new Map<string, (typeof existingRows)[0]>();
  const rowsByLastName = new Map<string, (typeof existingRows)[0]>();
  for (const row of existingRows) {
    rowsByName.set(normalizeName(row.pitcherName), row);
    rowsByLastName.set(getLastName(row.pitcherName), row);
  }

  // Process each AN prop
  // AN props come in pairs (OVER + UNDER) — we only need to process each pitcher once
  const processedPitchers = new Set<string>();

  for (const anProp of anResult.props) {
    const anName = anProp.pitcherName;
    const anNameNorm = normalizeName(anName);

    // Skip if we already processed this pitcher (avoid double-update for OVER/UNDER pair)
    if (processedPitchers.has(anNameNorm)) continue;
    processedPitchers.add(anNameNorm);

    // Find matching DB row
    let matchedRow = rowsByName.get(anNameNorm);
    let matchType: "exact" | "lastName" = "exact";

    if (!matchedRow) {
      // Fallback: last name match
      const lastName = getLastName(anName);
      matchedRow = rowsByLastName.get(lastName);
      matchType = "lastName";
    }

    if (!matchedRow) {
      console.log(
        `[KPropsDB][WARN] No DB row found for AN pitcher: ${anName} (normalized: ${anNameNorm})`
      );
      result.notFound++;
      result.details.push({
        pitcherName: anName,
        anLine: anProp.line,
        matched: false,
      });
      continue;
    }

    // Find the AN prop for this pitcher (one entry per pitcher with both odds)
    const anPropFull =
      anResult.props.find(p => normalizeName(p.pitcherName) === anNameNorm) ??
      anResult.props.find(
        p => getLastName(p.pitcherName) === getLastName(anName)
      );

    if (!anPropFull) {
      result.notFound++;
      continue;
    }

    const line = anPropFull.line;
    const overOdds = anPropFull.overOdds;
    const underOdds = anPropFull.underOdds;
    const noVigOverPct = anPropFull.noVigOverPct;
    const anPlayerId = anPropFull.anPlayerId;

    // Update all rows for this pitcher (both OVER and UNDER sides)
    const matchingRows = existingRows.filter(
      (r: (typeof existingRows)[0]) =>
        normalizeName(r.pitcherName) === anNameNorm ||
        getLastName(r.pitcherName) === getLastName(anName)
    );

    for (const row of matchingRows) {
      try {
        const dbUpdate = await getDb();
        await dbUpdate
          .update(mlbStrikeoutProps)
          .set({
            bookLine: line.toString(),
            bookOverOdds: overOdds !== null ? String(overOdds) : null,
            bookUnderOdds: underOdds !== null ? String(underOdds) : null,
            anNoVigOverPct:
              noVigOverPct !== null ? noVigOverPct.toFixed(4) : null,
            anPlayerId: anPlayerId !== null ? Number(anPlayerId) : null,
          })
          .where(eq(mlbStrikeoutProps.id, row.id));

        result.updated++;
        console.log(
          `[KPropsDB][OUTPUT] Updated ${row.pitcherName} (${row.side}) | line=${line} | overOdds=${overOdds} | underOdds=${underOdds} | noVig=${noVigOverPct?.toFixed(3)} | matchType=${matchType}`
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        const cause = (err as { cause?: unknown })?.cause;
        const causeMsg =
          cause instanceof Error ? ` | cause: ${cause.message}` : "";
        console.error(
          `[KPropsDB][ERROR] Failed to update row ${row.id}: ${msg}${causeMsg}`
        );
        result.errors++;
      }
    }

    result.details.push({
      pitcherName: anName,
      anLine: line,
      matched: true,
      matchType,
    });
  }

  console.log(
    `[KPropsDB][OUTPUT] AN update complete: updated=${result.updated} notFound=${result.notFound} errors=${result.errors}`
  );

  return result;
}

// ── Convenience wrapper: upsertKPropsForDate ──────────────────────────────────
/**
 * Fetch AN K-Props for a date and upsert into DB.
 * This is the primary entry point for the pipeline.
 *
 * @param anDateStr - YYYYMMDD format (e.g. "20260327")
 * @returns UpsertKPropsResult
 */
export async function upsertKPropsForDate(
  anDateStr: string
): Promise<UpsertKPropsResult> {
  const { fetchANKProps } = await import("./anKPropsService");
  const gameDate = `${anDateStr.slice(0, 4)}-${anDateStr.slice(4, 6)}-${anDateStr.slice(6, 8)}`;
  const anResult = await fetchANKProps(anDateStr);
  return upsertKPropsFromAN(anResult, gameDate);
}
