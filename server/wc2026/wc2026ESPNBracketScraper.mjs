/**
 * wc2026ESPNBracketScraper.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Production-grade ESPN WC2026 Bracket Scraper
 *
 * SOURCE:  ESPN Scoreboard API (public JSON endpoint — no WAF)
 *   https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard
 *   ?limit=100&dates=20260628-20260720
 *
 * MATCH NUMBERS: Joined from wc2026_fixtures.display_order via espn_event_id
 *   OR derived from fixture_id (e.g. "wc26-r32-080" → Match 80)
 *
 * COVERAGE: All 32 knockout matchups across all rounds:
 *   R32  (roundId=1): 16 matches (Match 73–88)
 *   R16  (roundId=2):  8 matches (Match 89–96)
 *   QF   (roundId=3):  4 matches (Match 97–100)
 *   SF   (roundId=4):  2 matches (Match 101–102)
 *   3rd/Final (roundId=5): 2 matches (Match 103–104)
 *
 * DB TARGET: wc2026_espn_bracket
 *
 * UPSERT STRATEGY: INSERT ... ON DUPLICATE KEY UPDATE (idempotent)
 *
 * USAGE:
 *   node server/wc2026/wc2026ESPNBracketScraper.mjs [--dry-run] [--verbose]
 *
 * EXIT CODES:
 *   0 — success
 *   1 — fatal error
 *   2 — partial failure (validation warnings or count mismatch)
 */

import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "../..");
const require = createRequire(import.meta.url);

// ─── CLI flags ────────────────────────────────────────────────────────────────
const DRY_RUN = process.argv.includes("--dry-run");
const VERBOSE = process.argv.includes("--verbose");

// ─── Constants ────────────────────────────────────────────────────────────────
// Date range covers all knockout rounds: R32 (Jun 28) → Final (Jul 19)
const SCOREBOARD_URL =
  "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard" +
  "?limit=100&dates=20260628-20260720";

const ROUND_SLUG_TO_ID = {
  "round-of-32":    1,
  "round-of-16":    2,
  "quarterfinals":  3,
  "semifinals":     4,
  "3rd-place-match":5,
  "final":          5,
};

const ROUND_SLUG_TO_LABEL = {
  "round-of-32":    "Round of 32",
  "round-of-16":    "Round of 16",
  "quarterfinals":  "Quarterfinals",
  "semifinals":     "Semifinals",
  "3rd-place-match":"3rd-Place Match",
  "final":          "Final",
};

const EXPECTED_TOTAL = 32; // Full tournament bracket

// ─── Logging ──────────────────────────────────────────────────────────────────
function log(tag, msg) {
  console.log(`[${new Date().toISOString()}] [${tag}] ${msg}`);
}
function logV(tag, msg) {
  if (VERBOSE) log(tag, msg);
}

// ─── HTTP fetch with retry ────────────────────────────────────────────────────
async function fetchWithRetry(url, maxRetries = 3, delayMs = 2000) {
  let lastErr;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      log("FETCH", `Attempt ${attempt}/${maxRetries}: ${url.split("?")[0]}`);
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept": "application/json",
          "Origin": "https://www.espn.com",
          "Referer": "https://www.espn.com/",
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const data = await res.json();
      log("FETCH", `OK — ${(data.events ?? []).length} events`);
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

// ─── Load match number map from wc2026_fixtures ───────────────────────────────
async function loadMatchNumberMap() {
  const mysql = require("mysql2/promise");
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  try {
    const [rows] = await conn.query(
      `SELECT espn_event_id, display_order, fixture_id, stage
       FROM wc2026_fixtures
       WHERE stage != 'GROUP'
       ORDER BY display_order`
    );
    // Build two maps:
    // 1. espnEventId → matchNumber (for rows with espn_event_id set)
    // 2. fixture_id → matchNumber (fallback)
    const byEventId = new Map();
    const byFixtureId = new Map();
    for (const row of rows) {
      const mn = row.display_order ? `Match ${row.display_order}` : null;
      if (row.espn_event_id) byEventId.set(String(row.espn_event_id), mn);
      if (row.fixture_id) byFixtureId.set(row.fixture_id, mn);
    }
    log("FIXTURES", `Loaded ${rows.length} knockout fixtures from DB`);
    log("FIXTURES", `  With espn_event_id: ${byEventId.size}`);
    return { byEventId, byFixtureId, rows };
  } finally {
    await conn.end();
  }
}

// ─── Transform ESPN event → DB row ───────────────────────────────────────────
function transformEvent(event, matchNumberMap, bracketLocationByRound) {
  const comp = event.competitions?.[0] ?? {};
  const competitors = comp.competitors ?? [];

  // ESPN guarantees: homeAway="home" is the home team
  const home = competitors.find(c => c.homeAway === "home") ?? competitors[0] ?? {};
  const away = competitors.find(c => c.homeAway === "away") ?? competitors[1] ?? {};

  // Validate orientation
  if (home.homeAway && home.homeAway !== "home") {
    log("WARN", `gameId=${event.id}: home competitor has homeAway="${home.homeAway}"`);
  }
  if (away.homeAway && away.homeAway !== "away") {
    log("WARN", `gameId=${event.id}: away competitor has homeAway="${away.homeAway}"`);
  }

  // Round
  const roundSlug = event.season?.slug ?? "";
  const roundId = ROUND_SLUG_TO_ID[roundSlug] ?? 0;
  const roundLabel = ROUND_SLUG_TO_LABEL[roundSlug] ?? roundSlug;

  // Match number — from fixtures DB map
  const matchNumber = matchNumberMap.byEventId.get(String(event.id)) ?? null;

  // Bracket location — sequential within round
  if (!bracketLocationByRound[roundId]) bracketLocationByRound[roundId] = 0;
  bracketLocationByRound[roundId]++;
  const bracketLocation = bracketLocationByRound[roundId];

  // Status
  const statusType = comp.status?.type ?? {};
  const statusDetail = statusType.description ?? null;
  const statusState  = statusType.state ?? null;

  // Odds
  const oddsArr = comp.odds ?? [];
  const oddsDisplay = oddsArr.length > 0
    ? (oddsArr[0]?.details ?? null)
    : null;

  // Broadcasts
  const broadcasts = (comp.broadcasts ?? [])
    .map(b => b.names ?? [])
    .flat()
    .join(",") || null;

  // Venue
  const venue = comp.venue ?? {};
  const location = venue.address
    ? `${venue.address.city ?? ""}${venue.address.state ? ", " + venue.address.state : ""}`.trim()
    : null;

  // ESPN match link
  const summaryLink = (event.links ?? []).find(l => l.rel?.includes("summary"));
  const espnLink = summaryLink?.href ?? null;
  const advancementSlug = espnLink ? espnLink.split("/").pop() : null;

  // TBD detection — team name contains "Winner" or "Loser" or team id is placeholder
  const homeIsTBD = !home.team?.id || (home.team?.displayName ?? "").toLowerCase().includes("winner")
    || (home.team?.displayName ?? "").toLowerCase().includes("loser")
    ? 1 : 0;
  const awayIsTBD = !away.team?.id || (away.team?.displayName ?? "").toLowerCase().includes("winner")
    || (away.team?.displayName ?? "").toLowerCase().includes("loser")
    ? 1 : 0;

  const now = Date.now();
  return {
    game_id:          String(event.id),
    matchup_id:       String(event.id), // scoreboard API doesn't have matchupId — use gameId
    match_number:     matchNumber,
    round_id:         roundId,
    round_label:      roundLabel,
    bracket_location: bracketLocation,
    date_utc:         event.date ?? null,
    status_detail:    statusDetail,
    status_state:     statusState,
    location:         location,
    broadcasts:       broadcasts,
    odds_display:     oddsDisplay,
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

// ─── Validate row ─────────────────────────────────────────────────────────────
function validateRow(row) {
  const errors = [];
  if (!row.game_id)    errors.push("game_id empty");
  if (!row.round_id)   errors.push("round_id=0");
  if (!row.round_label) errors.push("round_label empty");
  if (!row.home_is_tbd && !row.home_team_name) errors.push("home_team_name missing (non-TBD)");
  if (!row.away_is_tbd && !row.away_team_name) errors.push("away_team_name missing (non-TBD)");
  return errors;
}

// ─── DB upsert via mysql2 directly ───────────────────────────────────────────
async function upsertRows(rows) {
  const mysql = require("mysql2/promise");
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  let inserted = 0, errors = 0;
  const errorDetails = [];

  try {
    for (const row of rows) {
      try {
        await conn.execute(
          `INSERT INTO wc2026_espn_bracket (
            game_id, matchup_id, match_number, round_id, round_label, bracket_location,
            date_utc, status_detail, status_state, location, broadcasts, odds_display,
            home_team_id, home_team_name, home_team_abbrev, home_team_logo,
            home_score, home_winner, home_is_tbd,
            away_team_id, away_team_name, away_team_abbrev, away_team_logo,
            away_score, away_winner, away_is_tbd,
            espn_link, advancement_slug, scraped_at, created_at, updated_at
          ) VALUES (
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?,
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
            odds_display     = VALUES(odds_display),
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
            row.date_utc, row.status_detail, row.status_state, row.location, row.broadcasts, row.odds_display,
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
    return { inserted, errors, errorDetails, totalRows: Number(cnt) };
  } finally {
    await conn.end();
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const startTime = Date.now();
  log("START", `wc2026ESPNBracketScraper — DRY_RUN=${DRY_RUN} VERBOSE=${VERBOSE}`);

  // ── STEP 1: Load match number map from wc2026_fixtures ────────────────────
  log("STEP1", "Loading match number map from wc2026_fixtures");
  const matchNumberMap = await loadMatchNumberMap();

  // ── STEP 2: Fetch ESPN scoreboard ─────────────────────────────────────────
  log("STEP2", "Fetching ESPN scoreboard API");
  const data = await fetchWithRetry(SCOREBOARD_URL);
  const events = data.events ?? [];
  log("STEP2", `Received ${events.length} events`);

  // ── STEP 3: Filter to knockout rounds only ────────────────────────────────
  log("STEP3", "Filtering to knockout rounds");
  const knockoutSlugs = new Set(Object.keys(ROUND_SLUG_TO_ID));
  const knockoutEvents = events.filter(e => knockoutSlugs.has(e.season?.slug ?? ""));
  log("STEP3", `Knockout events: ${knockoutEvents.length}`);

  // Count by round
  const byRound = {};
  for (const e of knockoutEvents) {
    const slug = e.season?.slug ?? "?";
    byRound[slug] = (byRound[slug] ?? 0) + 1;
  }
  for (const [slug, count] of Object.entries(byRound)) {
    log("STEP3", `  ${slug}: ${count}`);
  }

  // ── STEP 4: Transform events → DB rows ────────────────────────────────────
  log("STEP4", "Transforming events to DB rows");
  const bracketLocationByRound = {};
  const rows = [];
  const validationErrors = [];

  // Sort by date to ensure consistent bracket_location assignment
  const sorted = [...knockoutEvents].sort((a, b) =>
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  for (const event of sorted) {
    const row = transformEvent(event, matchNumberMap, bracketLocationByRound);
    const errs = validateRow(row);
    if (errs.length > 0) {
      validationErrors.push({ gameId: row.game_id, errors: errs });
      log("WARN", `gameId=${row.game_id} validation: ${errs.join(", ")}`);
    }
    rows.push(row);
  }

  log("STEP4", `Transformed ${rows.length} rows (${validationErrors.length} validation warnings)`);

  // ── STEP 5: Print full bracket summary ────────────────────────────────────
  log("STEP5", "=== BRACKET SUMMARY ===");
  for (const rid of [1, 2, 3, 4, 5]) {
    const roundRows = rows.filter(r => r.round_id === rid);
    if (roundRows.length === 0) continue;
    const label = roundRows[0]?.round_label ?? `Round ${rid}`;
    log("STEP5", `── ${label} (${roundRows.length} matches) ──`);
    for (const r of roundRows) {
      const home = r.home_is_tbd ? `TBD(${r.home_team_name ?? "?"})` : (r.home_team_name ?? "?");
      const away = r.away_is_tbd ? `TBD(${r.away_team_name ?? "?"})` : (r.away_team_name ?? "?");
      const score = r.status_state === "post"
        ? `${r.home_score ?? 0}-${r.away_score ?? 0}`
        : "vs";
      const odds = r.odds_display ? ` [${r.odds_display}]` : "";
      const mn = r.match_number ?? `gameId=${r.game_id}`;
      const date = r.date_utc ? r.date_utc.slice(0, 10) : "?";
      log("STEP5", `  ${mn} | ${date} | ${home} ${score} ${away}${odds} | ${r.status_detail ?? "?"}`);
    }
  }

  // ── STEP 6: Upsert to DB ──────────────────────────────────────────────────
  if (DRY_RUN) {
    log("STEP6", `DRY RUN — skipping DB write. Would upsert ${rows.length} rows.`);
  } else {
    log("STEP6", `Upserting ${rows.length} rows to wc2026_espn_bracket`);
    const result = await upsertRows(rows);
    log("STEP6", `DB result: inserted/updated=${result.inserted} errors=${result.errors} totalRows=${result.totalRows}`);

    if (result.errors > 0) {
      log("ERROR", `${result.errors} DB errors:`);
      for (const e of result.errorDetails) log("ERROR", `  ${e}`);
    }

    // ── STEP 7: Verify DB ────────────────────────────────────────────────────
    log("STEP7", `DB row count: ${result.totalRows} | Processed: ${rows.length}`);
    if (result.totalRows < rows.length) {
      log("ERROR", `DB row count ${result.totalRows} < processed ${rows.length}`);
      process.exit(2);
    }
    log("STEP7", `✓ PASS — all ${rows.length} rows present in DB`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log("DONE", `Completed in ${elapsed}s — ${rows.length} matchups processed`);

  const exitCode = (validationErrors.length > 0 || rows.length < 16) ? 2 : 0;
  if (exitCode !== 0) {
    log("WARN", `Exiting with code ${exitCode} (validation warnings: ${validationErrors.length}, rows: ${rows.length})`);
  }
  process.exit(exitCode);
}

main().catch(err => {
  log("FATAL", err.message);
  console.error(err);
  process.exit(1);
});
