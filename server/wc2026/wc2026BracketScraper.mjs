/**
 * wc2026BracketScraper.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * WC2026 Bracket Advancement Engine — Core Production File
 *
 * PURPOSE (three core concepts):
 *   1. ADVANCEMENT RESOLUTION
 *      For every FT bracket match: read ESPN winner flag → write
 *      advancing_team_id to wc2026_fixtures. Handles regulation, ET, and
 *      penalty winners. Never overwrites an already-set advancing_team_id.
 *
 *   2. OPPONENT MAPPING
 *      Using the hardcoded bracket seeding graph, when a winner is confirmed
 *      for a source match, resolve the next-round fixture slot and update
 *      wc2026_fixtures.home_team_id / away_team_id for that TBD slot.
 *      This is the engine that propagates teams through R32 → R16 → QF → SF → Final.
 *
 *   3. CALENDAR SEEDING
 *      When ESPN returns a confirmed date/time for a future match that is
 *      currently TBD in wc2026_fixtures, update match_date and kickoff_utc.
 *      Ensures the model pipeline always has correct kickoff times.
 *
 * SOURCE: ESPN Scoreboard API (public JSON — no WAF, no auth required)
 *   https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard
 *   ?limit=100&dates=20260628-20260720
 *
 * DB TARGETS:
 *   wc2026_espn_bracket   — bracket snapshot (all 32 matchups, all rounds)
 *   wc2026_fixtures       — canonical fixture table (advancement + calendar seeding)
 *
 * HEARTBEAT: POST /api/scheduled/wc2026-bracket-sync
 *   Cadence: every 30 min during knockout phase (Jun 28 – Jul 19)
 *
 * LOGGING FORMAT (matches core file standard):
 *   [WC2026BS] [INPUT]  → source, events fetched
 *   [WC2026BS] [STEP]   → per-phase operation
 *   [WC2026BS] [STATE]  → intermediate computation
 *   [WC2026BS] [DB]     → database read/write
 *   [WC2026BS] [OUTPUT] → final result summary
 *   [WC2026BS] [VERIFY] → PASS / FAIL + reason
 *
 * USAGE:
 *   node server/wc2026/wc2026BracketScraper.mjs [--dry-run] [--verbose]
 *
 * EXIT CODES:
 *   0 — success, all phases clean
 *   1 — fatal error (ESPN fetch failed, DB unreachable)
 *   2 — partial failure (validation warnings, count mismatch)
 */

import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "../..");
const require = createRequire(import.meta.url);

// ─── CLI flags ────────────────────────────────────────────────────────────────
const DRY_RUN  = process.argv.includes("--dry-run");
const VERBOSE  = process.argv.includes("--verbose");

// ─── Constants ────────────────────────────────────────────────────────────────
const TAG = "WC2026BS";

// ESPN scoreboard: all knockout rounds Jun 28 – Jul 19
const SCOREBOARD_URL =
  "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard" +
  "?limit=100&dates=20260628-20260720";

const ESPN_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "Accept":     "application/json",
  "Origin":     "https://www.espn.com",
  "Referer":    "https://www.espn.com/",
};

// Round slug → internal roundId
const ROUND_SLUG_TO_ID = {
  "round-of-32":     1,
  "round-of-16":     2,
  "quarterfinals":   3,
  "semifinals":      4,
  "3rd-place-match": 5,
  "final":           6,
};

const ROUND_SLUG_TO_LABEL = {
  "round-of-32":     "Round of 32",
  "round-of-16":     "Round of 16",
  "quarterfinals":   "Quarterfinals",
  "semifinals":      "Semifinals",
  "3rd-place-match": "3rd-Place Match",
  "final":           "Final",
};

const KNOCKOUT_SLUGS = new Set(Object.keys(ROUND_SLUG_TO_ID));

// ─── Static match number map (from ESPN bracket HTML forensic audit) ──────────
// ESPN game ID → Match number. These are fixed at tournament draw — never change.
const STATIC_MATCH_NUMBERS = {
  // Round of 32 (Match 73–88) — backfilled from wc2026_fixtures.display_order
  // These are resolved dynamically via DB join; listed here for documentation only.
  // Round of 16 (Match 89–96)
  "760503": "Match 89",   // Paraguay vs France
  "760502": "Match 90",   // Canada vs Morocco
  "760504": "Match 91",   // Brazil vs Norway
  "760505": "Match 92",   // Mexico vs W(Match 82)
  "760506": "Match 93",   // W(Match 79) vs W(Match 80)
  "760507": "Match 94",   // W(Match 76) vs W(Match 78)
  "760509": "Match 95",   // W(Match 88) vs W(Match 87)
  "760508": "Match 96",   // W(Match 86) vs W(Match 85)
  // Quarterfinals (Match 97–100)
  "760510": "Match 97",   // W(Match 89) vs W(Match 90)
  "760511": "Match 98",   // W(Match 93) vs W(Match 94)
  "760512": "Match 99",   // W(Match 91) vs W(Match 92)
  "760513": "Match 100",  // W(Match 95) vs W(Match 96)
  // Semifinals (Match 101–102)
  "760514": "Match 101",  // W(Match 97) vs W(Match 98)
  "760515": "Match 102",  // W(Match 99) vs W(Match 100)
  // 3rd Place & Final (Match 103–104)
  "760516": "Match 103",  // L(Match 101) vs L(Match 102)
  "760517": "Match 104",  // W(Match 101) vs W(Match 102)
};

// ─── Bracket seeding graph ────────────────────────────────────────────────────
// Maps each source match → which next-round fixture it feeds and which slot (home/away).
// Key:   ESPN game ID of the SOURCE match (the one being won)
// Value: { nextGameId, slot: "home"|"away" }
//
// This graph is the core of OPPONENT MAPPING.
// Derived from ESPN bracket HTML forensic audit (pasted_content_61-65.txt).
//
// Reading: "When Match 73 (gameId 760486) produces a winner,
//           that winner fills the AWAY slot of Match 90 (gameId 760502)"
const BRACKET_SEEDING_GRAPH = {
  // R32 → R16
  "760486": { nextGameId: "760502", slot: "away" },  // M73 W → M90 away (Canada)
  "760487": { nextGameId: "760504", slot: "home" },  // M74 W → M91 home (Brazil)
  "760488": { nextGameId: "760507", slot: "home" },  // M76 W → M94 home
  "760489": { nextGameId: "760503", slot: "away" },  // M75 W → M89 away (Paraguay)
  "760490": { nextGameId: "760507", slot: "away" },  // M77 W → M94 away
  "760491": { nextGameId: "760506", slot: "home" },  // M79 W → M93 home (Mexico)
  "760492": { nextGameId: "760503", slot: "home" },  // M78 W → M89 home (France)
  "760493": { nextGameId: "760502", slot: "home" },  // M82 W → M90 home  [NOTE: M82=Belgium/Senegal, feeds M90 home]
  "760494": { nextGameId: "760505", slot: "home" },  // M83 W → M92 home  [Spain/Austria → M92 home]
  "760495": { nextGameId: "760506", slot: "away" },  // M80 W → M93 away  (England/Congo DR)
  "760496": { nextGameId: "760504", slot: "away" },  // M81 W → M91 away  (Senegal/Belgium — M81)
  "760497": { nextGameId: "760505", slot: "away" },  // M84 W → M92 away  (Portugal/Croatia)
  "760498": { nextGameId: "760508", slot: "away" },  // M85 W → M96 away  (Switzerland/Algeria)
  "760499": { nextGameId: "760508", slot: "home" },  // M86 W → M96 home  (Australia/Egypt)
  "760500": { nextGameId: "760509", slot: "away" },  // M87 W → M95 away  (Cape Verde/Argentina)
  "760501": { nextGameId: "760509", slot: "home" },  // M88 W → M95 home  (Ghana/Colombia)
  // R16 → QF
  "760503": { nextGameId: "760510", slot: "home" },  // M89 W → M97 home
  "760502": { nextGameId: "760510", slot: "away" },  // M90 W → M97 away
  "760504": { nextGameId: "760512", slot: "home" },  // M91 W → M99 home
  "760505": { nextGameId: "760512", slot: "away" },  // M92 W → M99 away
  "760506": { nextGameId: "760511", slot: "home" },  // M93 W → M98 home
  "760507": { nextGameId: "760511", slot: "away" },  // M94 W → M98 away
  "760509": { nextGameId: "760513", slot: "home" },  // M95 W → M100 home
  "760508": { nextGameId: "760513", slot: "away" },  // M96 W → M100 away
  // QF → SF
  "760510": { nextGameId: "760514", slot: "home" },  // M97 W → M101 home
  "760511": { nextGameId: "760514", slot: "away" },  // M98 W → M101 away
  "760512": { nextGameId: "760515", slot: "home" },  // M99 W → M102 home
  "760513": { nextGameId: "760515", slot: "away" },  // M100 W → M102 away
  // SF → Final + 3rd Place
  "760514": { nextGameId: "760517", slot: "home" },  // M101 W → M104 home (Final)
  "760515": { nextGameId: "760517", slot: "away" },  // M102 W → M104 away (Final)
  // SF losers → 3rd Place (separate graph entries)
  "760514_loser": { nextGameId: "760516", slot: "home" }, // M101 L → M103 home
  "760515_loser": { nextGameId: "760516", slot: "away" }, // M102 L → M103 away
};

// ESPN game ID → fixture_id in wc2026_fixtures
// Populated dynamically from DB; this static map is the fallback for R16+
const STATIC_GAME_ID_TO_FIXTURE_ID = {
  // R32 — dynamically resolved via espn_event_id in wc2026_fixtures
  // R16
  "760503": "wc26-r16-089",
  "760502": "wc26-r16-090",
  "760504": "wc26-r16-091",
  "760505": "wc26-r16-092",
  "760506": "wc26-r16-093",
  "760507": "wc26-r16-094",
  "760509": "wc26-r16-095",
  "760508": "wc26-r16-096",
  // QF
  "760510": "wc26-qf-097",
  "760511": "wc26-qf-098",
  "760512": "wc26-qf-099",
  "760513": "wc26-qf-100",
  // SF
  "760514": "wc26-sf-101",
  "760515": "wc26-sf-102",
  // 3rd / Final
  "760516": "wc26-3rd-103",
  "760517": "wc26-final-104",
};

// ─── Logging ──────────────────────────────────────────────────────────────────
function log(phase, msg) {
  console.log(`[${new Date().toISOString()}] [${TAG}] [${phase}] ${msg}`);
}
function logV(phase, msg) {
  if (VERBOSE) log(phase, msg);
}

// ─── HTTP fetch with retry ────────────────────────────────────────────────────
async function fetchWithRetry(url, maxRetries = 3, delayMs = 2000) {
  let lastErr;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      log("FETCH", `Attempt ${attempt}/${maxRetries}: ${url.split("?")[0]}`);
      const res = await fetch(url, { headers: ESPN_HEADERS });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const data = await res.json();
      log("FETCH", `OK — ${(data.events ?? []).length} events returned`);
      return data;
    } catch (err) {
      lastErr = err;
      log("FETCH", `Attempt ${attempt} FAILED: ${err.message}`);
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, delayMs * attempt));
      }
    }
  }
  throw new Error(`All ${maxRetries} fetch attempts failed: ${lastErr.message}`);
}

// ─── DB connection helper ─────────────────────────────────────────────────────
async function getConn() {
  const mysql = require("mysql2/promise");
  return mysql.createConnection(process.env.DATABASE_URL);
}

// ─── Load fixture map from wc2026_fixtures ────────────────────────────────────
// Returns:
//   byEspnId:   Map<espn_event_id → { fixtureId, homeTeamId, awayTeamId, advancingTeamId, matchDate, kickoffUtc, status }>
//   byFixtureId: Map<fixture_id → same>
async function loadFixtureMap(conn) {
  log("INPUT", "Loading wc2026_fixtures knockout rows");
  const [rows] = await conn.query(`
    SELECT
      fixture_id, espn_event_id, stage, display_order,
      home_team_id, away_team_id, advancing_team_id,
      match_date, kickoff_utc, status
    FROM wc2026_fixtures
    WHERE stage != 'GROUP'
    ORDER BY display_order
  `);
  const byEspnId    = new Map();
  const byFixtureId = new Map();
  for (const r of rows) {
    if (r.espn_event_id) byEspnId.set(String(r.espn_event_id), r);
    byFixtureId.set(r.fixture_id, r);
  }
  log("INPUT", `Loaded ${rows.length} knockout fixtures | with espn_event_id: ${byEspnId.size}`);
  return { byEspnId, byFixtureId, rows };
}

// ─── Transform ESPN event → bracket snapshot row ──────────────────────────────
// NOTE: No odds extraction. Bracket snapshot only.
function transformEvent(event, matchNumberMap, bracketLocationByRound) {
  const comp        = event.competitions?.[0] ?? {};
  const competitors = comp.competitors ?? [];

  const home = competitors.find(c => c.homeAway === "home") ?? competitors[0] ?? {};
  const away = competitors.find(c => c.homeAway === "away") ?? competitors[1] ?? {};

  // Validate orientation
  if (home.homeAway && home.homeAway !== "home") {
    log("WARN", `gameId=${event.id}: home competitor has homeAway="${home.homeAway}" — orientation mismatch`);
  }

  const roundSlug  = event.season?.slug ?? "";
  const roundId    = ROUND_SLUG_TO_ID[roundSlug] ?? 0;
  const roundLabel = ROUND_SLUG_TO_LABEL[roundSlug] ?? roundSlug;

  // Match number: static map (R16+) → fixtures DB (R32) → null
  const matchNumber = STATIC_MATCH_NUMBERS[String(event.id)]
    ?? matchNumberMap.byEventId.get(String(event.id))
    ?? null;

  // Bracket location — sequential within round, sorted by date
  if (!bracketLocationByRound[roundId]) bracketLocationByRound[roundId] = 0;
  bracketLocationByRound[roundId]++;
  const bracketLocation = bracketLocationByRound[roundId];

  // Status
  const statusType   = comp.status?.type ?? {};
  const statusDetail = statusType.description ?? null;
  const statusState  = statusType.state ?? null;
  const isCompleted  = statusType.completed ?? false;

  // Venue / location
  const venue    = comp.venue ?? {};
  const location = venue.address
    ? `${venue.address.city ?? ""}${venue.address.state ? ", " + venue.address.state : ""}`.trim()
    : null;

  // Broadcasts
  const broadcasts = (comp.broadcasts ?? [])
    .map(b => b.names ?? []).flat().join(",") || null;

  // ESPN match link (for advancement_slug — used for deep-linking, not odds)
  const summaryLink    = (event.links ?? []).find(l => l.rel?.includes("summary"));
  const espnLink       = summaryLink?.href ?? null;
  const advancementSlug = espnLink ? espnLink.split("/").pop() : null;

  // TBD detection
  const homeIsTBD = !home.team?.id
    || (home.team?.displayName ?? "").toLowerCase().includes("winner")
    || (home.team?.displayName ?? "").toLowerCase().includes("loser") ? 1 : 0;
  const awayIsTBD = !away.team?.id
    || (away.team?.displayName ?? "").toLowerCase().includes("winner")
    || (away.team?.displayName ?? "").toLowerCase().includes("loser") ? 1 : 0;

  const now = Date.now();
  return {
    game_id:          String(event.id),
    matchup_id:       String(event.id),
    match_number:     matchNumber,
    round_id:         roundId,
    round_label:      roundLabel,
    bracket_location: bracketLocation,
    date_utc:         event.date ?? null,
    status_detail:    statusDetail,
    status_state:     statusState,
    is_completed:     isCompleted ? 1 : 0,
    location:         location,
    broadcasts:       broadcasts,
    // Home team
    home_team_id:     home.team?.id ? String(home.team.id) : null,
    home_team_name:   home.team?.displayName ?? null,
    home_team_abbrev: home.team?.abbreviation ?? null,
    home_team_logo:   home.team?.logo ?? null,
    home_score:       home.score != null ? String(home.score) : null,
    home_winner:      home.winner ? 1 : 0,
    home_is_tbd:      homeIsTBD,
    // Away team
    away_team_id:     away.team?.id ? String(away.team.id) : null,
    away_team_name:   away.team?.displayName ?? null,
    away_team_abbrev: away.team?.abbreviation ?? null,
    away_team_logo:   away.team?.logo ?? null,
    away_score:       away.score != null ? String(away.score) : null,
    away_winner:      away.winner ? 1 : 0,
    away_is_tbd:      awayIsTBD,
    // Advancement
    espn_link:        espnLink,
    advancement_slug: advancementSlug,
    // Metadata
    scraped_at:       now,
    created_at:       now,
    updated_at:       now,
  };
}

// ─── Validate bracket row ─────────────────────────────────────────────────────
function validateRow(row) {
  const errors = [];
  if (!row.game_id)     errors.push("game_id empty");
  if (!row.round_id)    errors.push("round_id=0 (unknown round slug)");
  if (!row.round_label) errors.push("round_label empty");
  if (!row.home_is_tbd && !row.home_team_name) errors.push("home_team_name missing (non-TBD)");
  if (!row.away_is_tbd && !row.away_team_name) errors.push("away_team_name missing (non-TBD)");
  return errors;
}

// ─── PHASE A: Upsert bracket snapshot to wc2026_espn_bracket ─────────────────
async function upsertBracketSnapshot(conn, rows) {
  log("STEP", `[PHASE-A] Upserting ${rows.length} rows to wc2026_espn_bracket`);
  let inserted = 0, errors = 0;
  const errorDetails = [];

  for (const row of rows) {
    try {
      await conn.execute(
        `INSERT INTO wc2026_espn_bracket (
          game_id, matchup_id, match_number, round_id, round_label, bracket_location,
          date_utc, status_detail, status_state, location, broadcasts,
          home_team_id, home_team_name, home_team_abbrev, home_team_logo,
          home_score, home_winner, home_is_tbd,
          away_team_id, away_team_name, away_team_abbrev, away_team_logo,
          away_score, away_winner, away_is_tbd,
          espn_link, advancement_slug, scraped_at, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?, ?
        )
        ON DUPLICATE KEY UPDATE
          matchup_id       = VALUES(matchup_id),
          match_number     = VALUES(match_number),
          round_id         = VALUES(round_id),
          round_label      = VALUES(round_label),
          bracket_location = VALUES(bracket_location),
          date_utc         = VALUES(date_utc),
          status_detail    = VALUES(status_detail),
          status_state     = VALUES(status_state),
          location         = VALUES(location),
          broadcasts       = VALUES(broadcasts),
          home_team_id     = VALUES(home_team_id),
          home_team_name   = VALUES(home_team_name),
          home_team_abbrev = VALUES(home_team_abbrev),
          home_team_logo   = VALUES(home_team_logo),
          home_score       = VALUES(home_score),
          home_winner      = VALUES(home_winner),
          home_is_tbd      = VALUES(home_is_tbd),
          away_team_id     = VALUES(away_team_id),
          away_team_name   = VALUES(away_team_name),
          away_team_abbrev = VALUES(away_team_abbrev),
          away_team_logo   = VALUES(away_team_logo),
          away_score       = VALUES(away_score),
          away_winner      = VALUES(away_winner),
          away_is_tbd      = VALUES(away_is_tbd),
          espn_link        = VALUES(espn_link),
          advancement_slug = VALUES(advancement_slug),
          scraped_at       = VALUES(scraped_at),
          updated_at       = VALUES(updated_at)`,
        [
          row.game_id, row.matchup_id, row.match_number, row.round_id, row.round_label, row.bracket_location,
          row.date_utc, row.status_detail, row.status_state, row.location, row.broadcasts,
          row.home_team_id, row.home_team_name, row.home_team_abbrev, row.home_team_logo,
          row.home_score, row.home_winner, row.home_is_tbd,
          row.away_team_id, row.away_team_name, row.away_team_abbrev, row.away_team_logo,
          row.away_score, row.away_winner, row.away_is_tbd,
          row.espn_link, row.advancement_slug, row.scraped_at, row.created_at, row.updated_at,
        ]
      );
      inserted++;
      logV("DB", `  ✓ gameId=${row.game_id} ${row.match_number ?? "?"} ${row.home_team_name ?? "TBD"} vs ${row.away_team_name ?? "TBD"}`);
    } catch (err) {
      errors++;
      errorDetails.push(`gameId=${row.game_id}: ${err.message}`);
      log("DB", `  ✗ ERROR gameId=${row.game_id}: ${err.message}`);
    }
  }

  const [[{ cnt }]] = await conn.query("SELECT COUNT(*) as cnt FROM wc2026_espn_bracket");
  log("OUTPUT", `[PHASE-A] Bracket snapshot: upserted=${inserted} errors=${errors} totalRows=${cnt}`);
  return { inserted, errors, errorDetails, totalRows: Number(cnt) };
}

// ─── PHASE B: Advancement Resolution ─────────────────────────────────────────
// For every FT bracket row where ESPN reports a winner:
//   1. Identify which team won (home_winner=1 or away_winner=1)
//   2. Resolve that team's team_id in wc2026_teams (via ESPN team name → alias lookup)
//   3. Write advancing_team_id to wc2026_fixtures for that match
//   4. Never overwrite an already-set advancing_team_id
//
// Returns: { resolved: number, skipped: number, errors: string[] }
async function resolveAdvancement(conn, rows, fixtureMap) {
  log("STEP", "[PHASE-B] Advancement Resolution — identifying FT winners");
  let resolved = 0, skipped = 0;
  const errors = [];

  const ftRows = rows.filter(r => r.is_completed === 1);
  log("STATE", `[PHASE-B] FT matches: ${ftRows.length} / ${rows.length} total`);

  for (const row of ftRows) {
    const gameId = row.game_id;

    // Determine winner from ESPN flags
    const winnerIsHome = row.home_winner === 1;
    const winnerIsAway = row.away_winner === 1;

    if (!winnerIsHome && !winnerIsAway) {
      log("WARN", `[PHASE-B] gameId=${gameId} ${row.match_number ?? "?"}: FT but no winner flag set — skipping`);
      skipped++;
      continue;
    }

    const winnerTeamName  = winnerIsHome ? row.home_team_name  : row.away_team_name;
    const winnerTeamAbbr  = winnerIsHome ? row.home_team_abbrev : row.away_team_abbrev;
    const winnerEspnId    = winnerIsHome ? row.home_team_id    : row.away_team_id;

    log("STATE", `[PHASE-B] gameId=${gameId} ${row.match_number ?? "?"}: winner=${winnerTeamName} (${winnerTeamAbbr}) espnTeamId=${winnerEspnId}`);

    // Find the fixture in wc2026_fixtures
    const fixture = fixtureMap.byEspnId.get(gameId)
      ?? fixtureMap.byFixtureId.get(STATIC_GAME_ID_TO_FIXTURE_ID[gameId] ?? "");

    if (!fixture) {
      log("WARN", `[PHASE-B] gameId=${gameId}: no matching fixture in wc2026_fixtures — cannot write advancing_team_id`);
      skipped++;
      continue;
    }

    // Skip if already set (but 'tbd' is not a real value — re-resolve)
    if (fixture.advancing_team_id && fixture.advancing_team_id !== 'tbd') {
      logV("STATE", `[PHASE-B] ${fixture.fixture_id}: advancing_team_id already set to '${fixture.advancing_team_id}' — skipping`);
      skipped++;
      continue;
    }

    // Resolve ESPN team name → wc2026_teams.team_id
    // Strategy: alias lookup → direct name → FIFA code abbreviation
    let teamId = null;

    // 1. Alias lookup
    const [aliasRows] = await conn.query(
      `SELECT team_id FROM wc2026_team_aliases WHERE alias = ? LIMIT 1`,
      [winnerTeamName]
    );
    if (aliasRows.length > 0) {
      teamId = aliasRows[0].team_id;
      logV("STATE", `[PHASE-B] Resolved "${winnerTeamName}" → team_id='${teamId}' via alias`);
    }

    // 2. Direct name match
    if (!teamId) {
      const [nameRows] = await conn.query(
        `SELECT team_id FROM wc2026_teams WHERE name = ? LIMIT 1`,
        [winnerTeamName]
      );
      if (nameRows.length > 0) {
        teamId = nameRows[0].team_id;
        logV("STATE", `[PHASE-B] Resolved "${winnerTeamName}" → team_id='${teamId}' via name`);
      }
    }

    // 3. FIFA code / abbreviation match
    if (!teamId && winnerTeamAbbr) {
      const [codeRows] = await conn.query(
        `SELECT team_id FROM wc2026_teams WHERE fifa_code = ? LIMIT 1`,
        [winnerTeamAbbr.toUpperCase()]
      );
      if (codeRows.length > 0) {
        teamId = codeRows[0].team_id;
        logV("STATE", `[PHASE-B] Resolved "${winnerTeamName}" (${winnerTeamAbbr}) → team_id='${teamId}' via FIFA code`);
      }
    }

    if (!teamId) {
      const msg = `[PHASE-B] CANNOT RESOLVE winner team "${winnerTeamName}" (${winnerTeamAbbr}) to wc2026_teams.team_id — fixture=${fixture.fixture_id}`;
      log("FAIL", msg);
      errors.push(msg);
      continue;
    }

    // Write advancing_team_id to wc2026_fixtures
    log("DB", `[PHASE-B] UPDATE wc2026_fixtures SET advancing_team_id='${teamId}' WHERE fixture_id='${fixture.fixture_id}'`);
    if (!DRY_RUN) {
      try {
        await conn.execute(
          `UPDATE wc2026_fixtures SET advancing_team_id = ? WHERE fixture_id = ?`,
          [teamId, fixture.fixture_id]
        );
        log("VERIFY", `[PHASE-B] PASS — ${fixture.fixture_id}: advancing_team_id='${teamId}' (${winnerTeamName})`);
        // Update local cache so Phase C sees the fresh value
        fixture.advancing_team_id = teamId;
        resolved++;
      } catch (err) {
        const msg = `[PHASE-B] DB UPDATE failed for ${fixture.fixture_id}: ${err.message}`;
        log("FAIL", msg);
        errors.push(msg);
      }
    } else {
      log("VERIFY", `[PHASE-B] DRY RUN — would set ${fixture.fixture_id} advancing_team_id='${teamId}' (${winnerTeamName})`);
      fixture.advancing_team_id = teamId; // update cache for dry-run Phase C simulation
      resolved++;
    }
  }

  log("OUTPUT", `[PHASE-B] Advancement resolution: resolved=${resolved} skipped=${skipped} errors=${errors.length}`);
  return { resolved, skipped, errors };
}

// ─── PHASE C: Opponent Mapping ────────────────────────────────────────────────
// For every match with a confirmed advancing_team_id (from Phase B or pre-existing):
//   1. Look up BRACKET_SEEDING_GRAPH to find the next-round fixture and slot
//   2. Resolve the next-round fixture in wc2026_fixtures
//   3. If the target slot (home/away) is still NULL or TBD, write the team_id
//
// This propagates teams through the full bracket tree automatically.
//
// Returns: { seeded: number, skipped: number, errors: string[] }
async function resolveOpponentMapping(conn, rows, fixtureMap) {
  log("STEP", "[PHASE-C] Opponent Mapping — propagating winners to next-round fixture slots");
  let seeded = 0, skipped = 0;
  const errors = [];

  for (const row of rows) {
    const gameId = row.game_id;
    const seedEntry = BRACKET_SEEDING_GRAPH[gameId];
    if (!seedEntry) {
      // Final and 3rd-place have no next round — expected
      logV("STATE", `[PHASE-C] gameId=${gameId}: no next-round entry in seeding graph (Final/3rd-place or unknown)`);
      continue;
    }

    // Find the source fixture to get advancing_team_id
    const srcFixture = fixtureMap.byEspnId.get(gameId)
      ?? fixtureMap.byFixtureId.get(STATIC_GAME_ID_TO_FIXTURE_ID[gameId] ?? "");

    if (!srcFixture) {
      logV("STATE", `[PHASE-C] gameId=${gameId}: source fixture not in wc2026_fixtures — skipping`);
      skipped++;
      continue;
    }

    const advancingTeamId = srcFixture.advancing_team_id;
    if (!advancingTeamId) {
      logV("STATE", `[PHASE-C] gameId=${gameId} ${row.match_number ?? "?"}: no advancing_team_id yet — skipping (match not complete)`);
      skipped++;
      continue;
    }

    // Find the target next-round fixture
    const { nextGameId, slot } = seedEntry;
    const targetFixtureId = STATIC_GAME_ID_TO_FIXTURE_ID[nextGameId];
    const targetFixture   = fixtureMap.byEspnId.get(nextGameId)
      ?? (targetFixtureId ? fixtureMap.byFixtureId.get(targetFixtureId) : null);

    if (!targetFixture) {
      log("WARN", `[PHASE-C] gameId=${gameId}: target fixture for nextGameId=${nextGameId} not found in wc2026_fixtures — cannot seed`);
      skipped++;
      continue;
    }

    const targetFixtureId2 = targetFixture.fixture_id;
    const currentSlotValue = slot === "home" ? targetFixture.home_team_id : targetFixture.away_team_id;

    // Skip if slot already has the correct team
    if (currentSlotValue === advancingTeamId) {
      logV("STATE", `[PHASE-C] ${targetFixtureId2} ${slot}_team_id already='${advancingTeamId}' — no change needed`);
      skipped++;
      continue;
    }

    // Skip if slot is already filled with a DIFFERENT real team (conflict — do not overwrite)
    // 'tbd' is the sentinel placeholder — always safe to overwrite
    if (currentSlotValue && currentSlotValue !== 'tbd' && currentSlotValue !== advancingTeamId) {
      log("WARN", `[PHASE-C] ${targetFixtureId2} ${slot}_team_id='${currentSlotValue}' but advancing team is '${advancingTeamId}' — CONFLICT, not overwriting`);
      skipped++;
      continue;
    }

    // Write the advancing team to the target slot
    const col = slot === "home" ? "home_team_id" : "away_team_id";
    log("DB", `[PHASE-C] UPDATE wc2026_fixtures SET ${col}='${advancingTeamId}' WHERE fixture_id='${targetFixtureId2}'`);

    if (!DRY_RUN) {
      try {
        await conn.execute(
          `UPDATE wc2026_fixtures SET ${col} = ? WHERE fixture_id = ?`,
          [advancingTeamId, targetFixtureId2]
        );
        log("VERIFY", `[PHASE-C] PASS — ${targetFixtureId2}: ${col}='${advancingTeamId}' (from ${row.match_number ?? gameId})`);
        // Update local cache
        if (slot === "home") targetFixture.home_team_id = advancingTeamId;
        else                 targetFixture.away_team_id = advancingTeamId;
        seeded++;
      } catch (err) {
        const msg = `[PHASE-C] DB UPDATE failed for ${targetFixtureId2}: ${err.message}`;
        log("FAIL", msg);
        errors.push(msg);
      }
    } else {
      log("VERIFY", `[PHASE-C] DRY RUN — would set ${targetFixtureId2} ${col}='${advancingTeamId}'`);
      if (slot === "home") targetFixture.home_team_id = advancingTeamId;
      else                 targetFixture.away_team_id = advancingTeamId;
      seeded++;
    }
  }

  log("OUTPUT", `[PHASE-C] Opponent mapping: seeded=${seeded} skipped=${skipped} errors=${errors.length}`);
  return { seeded, skipped, errors };
}

// ─── PHASE D: Calendar Seeding ────────────────────────────────────────────────
// For every future bracket match where ESPN has confirmed a date/time:
//   1. Check if wc2026_fixtures.match_date or kickoff_utc is NULL or differs
//   2. If ESPN has a confirmed date, update match_date + kickoff_utc
//
// ESPN date format: ISO 8601 UTC string (e.g. "2026-07-05T21:00:00Z")
// wc2026_fixtures.match_date: DATE (YYYY-MM-DD)
// wc2026_fixtures.kickoff_utc: DATETIME or BIGINT (ms since epoch)
//
// Returns: { seeded: number, skipped: number, errors: string[] }
async function seedCalendar(conn, rows, fixtureMap) {
  log("STEP", "[PHASE-D] Calendar Seeding — updating match_date + kickoff_utc for confirmed fixtures");
  let seeded = 0, skipped = 0;
  const errors = [];

  for (const row of rows) {
    if (!row.date_utc) {
      logV("STATE", `[PHASE-D] gameId=${row.game_id}: no date_utc from ESPN — skipping`);
      skipped++;
      continue;
    }

    // Skip TBD matches (both teams unknown — date may be placeholder)
    if (row.home_is_tbd && row.away_is_tbd) {
      logV("STATE", `[PHASE-D] gameId=${row.game_id} ${row.match_number ?? "?"}: both teams TBD — skipping calendar seed`);
      skipped++;
      continue;
    }

    const fixture = fixtureMap.byEspnId.get(row.game_id)
      ?? fixtureMap.byFixtureId.get(STATIC_GAME_ID_TO_FIXTURE_ID[row.game_id] ?? "");

    if (!fixture) {
      logV("STATE", `[PHASE-D] gameId=${row.game_id}: no fixture in wc2026_fixtures — skipping`);
      skipped++;
      continue;
    }

    // Parse ESPN date
    const espnDate    = new Date(row.date_utc);
    const espnDateStr = espnDate.toISOString().slice(0, 10); // YYYY-MM-DD
    // kickoff_utc is a DATETIME column — format as 'YYYY-MM-DD HH:MM:SS' UTC
    const espnKickoffStr = espnDate.toISOString().replace('T', ' ').slice(0, 19); // MySQL DATETIME

    // Check if update needed
    const currentDate    = fixture.match_date ? String(fixture.match_date).slice(0, 10) : null;
    const currentKickoff = fixture.kickoff_utc ? String(fixture.kickoff_utc).slice(0, 19) : null;

    const dateChanged    = currentDate    !== espnDateStr;
    const kickoffChanged = currentKickoff !== espnKickoffStr;

    if (!dateChanged && !kickoffChanged) {
      logV("STATE", `[PHASE-D] ${fixture.fixture_id}: match_date and kickoff_utc already correct — no change`);
      skipped++;
      continue;
    }

    log("DB", `[PHASE-D] UPDATE wc2026_fixtures SET match_date='${espnDateStr}', kickoff_utc='${espnKickoffStr}' WHERE fixture_id='${fixture.fixture_id}'`);

    if (!DRY_RUN) {
      try {
        await conn.execute(
          `UPDATE wc2026_fixtures SET match_date = ?, kickoff_utc = ? WHERE fixture_id = ?`,
          [espnDateStr, espnKickoffStr, fixture.fixture_id]
        );
        log("VERIFY", `[PHASE-D] PASS — ${fixture.fixture_id}: match_date='${espnDateStr}' kickoff_utc='${espnKickoffStr}'`);
        fixture.match_date  = espnDateStr;
        fixture.kickoff_utc = espnKickoffStr;
        seeded++;
      } catch (err) {
        const msg = `[PHASE-D] DB UPDATE failed for ${fixture.fixture_id}: ${err.message}`;
        log("FAIL", msg);
        errors.push(msg);
      }
    } else {
      log("VERIFY", `[PHASE-D] DRY RUN — would set ${fixture.fixture_id} match_date='${espnDateStr}' kickoff_utc='${espnKickoffStr}'`);
      fixture.match_date  = espnDateStr;
      fixture.kickoff_utc = espnKickoffStr;
      seeded++;
    }
  }

  log("OUTPUT", `[PHASE-D] Calendar seeding: seeded=${seeded} skipped=${skipped} errors=${errors.length}`);
  return { seeded, skipped, errors };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const startTime = Date.now();
  log("INPUT", `wc2026BracketScraper — DRY_RUN=${DRY_RUN} VERBOSE=${VERBOSE}`);
  log("INPUT", `Phases: A=BracketSnapshot | B=AdvancementResolution | C=OpponentMapping | D=CalendarSeeding`);

  const conn = await getConn();
  let exitCode = 0;

  try {
    // ── STEP 1: Load fixture map ──────────────────────────────────────────────
    const fixtureMap = await loadFixtureMap(conn);

    // Build match number map from fixtures DB (R32 only — R16+ use STATIC_MATCH_NUMBERS)
    const matchNumberMap = {
      byEventId:    new Map(),
      byFixtureId:  new Map(),
    };
    for (const r of fixtureMap.rows) {
      const mn = r.display_order ? `Match ${r.display_order}` : null;
      if (r.espn_event_id) matchNumberMap.byEventId.set(String(r.espn_event_id), mn);
      matchNumberMap.byFixtureId.set(r.fixture_id, mn);
    }

    // ── STEP 2: Fetch ESPN scoreboard ─────────────────────────────────────────
    log("STEP", "Fetching ESPN scoreboard API");
    const data   = await fetchWithRetry(SCOREBOARD_URL);
    const events = data.events ?? [];
    log("STATE", `Received ${events.length} total events from ESPN`);

    // ── STEP 3: Filter to knockout rounds ─────────────────────────────────────
    const knockoutEvents = events.filter(e => KNOCKOUT_SLUGS.has(e.season?.slug ?? ""));
    log("STATE", `Knockout events: ${knockoutEvents.length}`);

    // Count by round
    const byRound = {};
    for (const e of knockoutEvents) {
      const slug = e.season?.slug ?? "?";
      byRound[slug] = (byRound[slug] ?? 0) + 1;
    }
    for (const [slug, count] of Object.entries(byRound)) {
      log("STATE", `  ${ROUND_SLUG_TO_LABEL[slug] ?? slug}: ${count} matches`);
    }

    // ── STEP 4: Transform events → bracket rows ───────────────────────────────
    log("STEP", "Transforming events to bracket rows");
    const bracketLocationByRound = {};
    const rows = [];
    const validationErrors = [];

    // Sort by date for consistent bracket_location assignment
    const sorted = [...knockoutEvents].sort((a, b) =>
      new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    for (const event of sorted) {
      const row  = transformEvent(event, matchNumberMap, bracketLocationByRound);
      const errs = validateRow(row);
      if (errs.length > 0) {
        validationErrors.push({ gameId: row.game_id, errors: errs });
        log("WARN", `gameId=${row.game_id} validation: ${errs.join(", ")}`);
      }
      rows.push(row);
    }
    log("STATE", `Transformed ${rows.length} rows (${validationErrors.length} validation warnings)`);

    // ── STEP 5: Print bracket summary ─────────────────────────────────────────
    log("STEP", "=== BRACKET SUMMARY ===");
    for (const rid of [1, 2, 3, 4, 5, 6]) {
      const roundRows = rows.filter(r => r.round_id === rid);
      if (roundRows.length === 0) continue;
      const label = roundRows[0]?.round_label ?? `Round ${rid}`;
      log("STEP", `── ${label} (${roundRows.length} matches) ──`);
      for (const r of roundRows) {
        const home  = r.home_is_tbd ? `TBD(${r.home_team_name ?? "?"})` : (r.home_team_name ?? "?");
        const away  = r.away_is_tbd ? `TBD(${r.away_team_name ?? "?"})` : (r.away_team_name ?? "?");
        const score = r.is_completed
          ? `${r.home_score ?? 0}-${r.away_score ?? 0} FT`
          : (r.status_state === "in" ? `${r.home_score ?? 0}-${r.away_score ?? 0} LIVE` : "vs");
        const mn   = r.match_number ?? `gameId=${r.game_id}`;
        const date = r.date_utc ? r.date_utc.slice(0, 10) : "?";
        log("STEP", `  ${mn} | ${date} | ${home} ${score} ${away} | ${r.status_detail ?? "Scheduled"}`);
      }
    }

    if (DRY_RUN) {
      log("STEP", "DRY RUN — skipping all DB writes");
      // Still run phases in dry-run mode for validation output
    }

    // ── PHASE A: Bracket Snapshot ─────────────────────────────────────────────
    const phaseA = await upsertBracketSnapshot(conn, rows);
    if (phaseA.errors > 0) {
      exitCode = 2;
      log("WARN", `[PHASE-A] ${phaseA.errors} DB errors — continuing to Phase B`);
    }

    // ── PHASE B: Advancement Resolution ──────────────────────────────────────
    const phaseB = await resolveAdvancement(conn, rows, fixtureMap);
    if (phaseB.errors.length > 0) {
      exitCode = 2;
      for (const e of phaseB.errors) log("WARN", e);
    }

    // ── PHASE C: Opponent Mapping ─────────────────────────────────────────────
    const phaseC = await resolveOpponentMapping(conn, rows, fixtureMap);
    if (phaseC.errors.length > 0) {
      exitCode = 2;
      for (const e of phaseC.errors) log("WARN", e);
    }

    // ── PHASE D: Calendar Seeding ─────────────────────────────────────────────
    const phaseD = await seedCalendar(conn, rows, fixtureMap);
    if (phaseD.errors.length > 0) {
      exitCode = 2;
      for (const e of phaseD.errors) log("WARN", e);
    }

    // ── FINAL SUMMARY ─────────────────────────────────────────────────────────
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log("OUTPUT", `=== wc2026BracketScraper COMPLETE in ${elapsed}s ===`);
    log("OUTPUT", `  Phase A (Bracket Snapshot):    upserted=${phaseA.inserted}  errors=${phaseA.errors}`);
    log("OUTPUT", `  Phase B (Advancement):         resolved=${phaseB.resolved}  skipped=${phaseB.skipped}  errors=${phaseB.errors.length}`);
    log("OUTPUT", `  Phase C (Opponent Mapping):    seeded=${phaseC.seeded}      skipped=${phaseC.skipped}  errors=${phaseC.errors.length}`);
    log("OUTPUT", `  Phase D (Calendar Seeding):    seeded=${phaseD.seeded}      skipped=${phaseD.skipped}  errors=${phaseD.errors.length}`);
    log("OUTPUT", `  Validation warnings: ${validationErrors.length}`);

    if (validationErrors.length > 0 || rows.length < 16) exitCode = 2;

    log("VERIFY", exitCode === 0 ? "✅ PASS — all phases clean" : `⚠️  PARTIAL — exit code ${exitCode}`);

  } catch (err) {
    log("FAIL", `FATAL: ${err.message}`);
    console.error(err);
    exitCode = 1;
  } finally {
    await conn.end();
  }

  process.exit(exitCode);
}

main().catch(err => {
  log("FATAL", err.message);
  console.error(err);
  process.exit(1);
});
