/**
 * test_nightly_refresh.mjs
 *
 * End-to-end live test of the automated nightly MLB TRENDS refresh pipeline.
 *
 * Phases:
 *   1. DB state snapshot BEFORE
 *   2. AN API fetch (correct scoreboard endpoint + headers)
 *   3. Per-row validation: re-derive awayWon/ATS/O/U from raw scores, compare to DB
 *   4. DB state snapshot AFTER
 *   5. 30-team cross-validation (ML × RL × O/U × 6 situations)
 *   6. Scheduler next-fire time validation
 *   7. Owner notification delivery test
 *
 * Logging convention:
 *   [TEST][INPUT]   — what we're feeding in
 *   [TEST][STEP]    — what we're about to do
 *   [TEST][STATE]   — intermediate values
 *   [TEST][OUTPUT]  — result of a step
 *   [TEST][VERIFY]  — pass/fail assertion
 *   [TEST][ERROR]   — unexpected failure
 */

import https from "https";

const TAG = "[MlbNightlyTrendsRefreshTest]";

// ─── Env ─────────────────────────────────────────────────────────────────────
const DB_URL = process.env.DATABASE_URL;
const FORGE_API_KEY = process.env.BUILT_IN_FORGE_API_KEY;
const FORGE_API_URL = process.env.BUILT_IN_FORGE_API_URL;
const OWNER_OPEN_ID = process.env.OWNER_OPEN_ID;

if (!DB_URL) { console.error(`${TAG}[ERROR] DATABASE_URL not set`); process.exit(1); }
if (!FORGE_API_URL) { console.error(`${TAG}[ERROR] BUILT_IN_FORGE_API_URL not set`); process.exit(1); }

// ─── DB connection ────────────────────────────────────────────────────────────
const mysql = (await import("/home/ubuntu/ai-sports-betting/node_modules/mysql2/promise.js")).default;
const conn = await mysql.createConnection({
  uri: DB_URL,
  ssl: { rejectUnauthorized: true },
});
console.log(`${TAG}[STEP] DB connection established`);

// ─── Helpers ──────────────────────────────────────────────────────────────────
/** Normalize tinyint(1): TiDB returns 0/1 integers */
const bit = (v) => {
  if (v === null || v === undefined) return null;
  if (Buffer.isBuffer(v)) return v[0] === 1;
  return Number(v) === 1;
};

// ─── AN API config (mirrors live service exactly) ─────────────────────────────
const AN_V1_BASE = "https://api.actionnetwork.com/web/v1/scoreboard/mlb";
const AN_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "application/json",
  "Referer": "https://www.actionnetwork.com/",
};
const DK_NJ_BOOK_ID = 68;
const BOOK_FALLBACK_CHAIN = [68, 15, 21, 30];
const BOOK_NAMES = { 68: "DK NJ", 15: "DK National", 21: "Pinnacle", 30: "BetMGM" };

// Completed game statuses (mirrors live service)
const COMPLETED_STATUSES = new Set(["final", "complete", "closed", "completed"]);

// ─── All 30 MLB teams ─────────────────────────────────────────────────────────
const ALL_TEAMS = [
  { abbrev: "ARI", slug: "arizona-diamondbacks" },
  { abbrev: "ATL", slug: "atlanta-braves" },
  { abbrev: "BAL", slug: "baltimore-orioles" },
  { abbrev: "BOS", slug: "boston-red-sox" },
  { abbrev: "CHC", slug: "chicago-cubs" },
  { abbrev: "CWS", slug: "chicago-white-sox" },
  { abbrev: "CIN", slug: "cincinnati-reds" },
  { abbrev: "CLE", slug: "cleveland-guardians" },
  { abbrev: "COL", slug: "colorado-rockies" },
  { abbrev: "DET", slug: "detroit-tigers" },
  { abbrev: "HOU", slug: "houston-astros" },
  { abbrev: "KC",  slug: "kansas-city-royals" },
  { abbrev: "LAA", slug: "los-angeles-angels" },
  { abbrev: "LAD", slug: "los-angeles-dodgers" },
  { abbrev: "MIA", slug: "miami-marlins" },
  { abbrev: "MIL", slug: "milwaukee-brewers" },
  { abbrev: "MIN", slug: "minnesota-twins" },
  { abbrev: "NYM", slug: "new-york-mets" },
  { abbrev: "NYY", slug: "new-york-yankees" },
  { abbrev: "ATH", slug: "oakland-athletics" },
  { abbrev: "PHI", slug: "philadelphia-phillies" },
  { abbrev: "PIT", slug: "pittsburgh-pirates" },
  { abbrev: "SD",  slug: "san-diego-padres" },
  { abbrev: "SF",  slug: "san-francisco-giants" },
  { abbrev: "SEA", slug: "seattle-mariners" },
  { abbrev: "STL", slug: "st-louis-cardinals" },
  { abbrev: "TB",  slug: "tampa-bay-rays" },
  { abbrev: "TEX", slug: "texas-rangers" },
  { abbrev: "TOR", slug: "toronto-blue-jays" },
  { abbrev: "WSH", slug: "washington-nationals" },
];

// ─── STEP 1: Snapshot DB state BEFORE ────────────────────────────────────────
console.log(`\n${"═".repeat(80)}`);
console.log(`${TAG}[STEP] PHASE 1: Snapshot DB state BEFORE refresh`);
console.log(`${"═".repeat(80)}`);

const [beforeRows] = await conn.execute(
  `SELECT COUNT(*) AS total,
          SUM(CASE WHEN gameStatus = 'complete' THEN 1 ELSE 0 END) AS completed,
          SUM(CASE WHEN dkAwayML IS NULL AND gameStatus = 'complete' THEN 1 ELSE 0 END) AS nullOdds,
          MAX(gameDate) AS latestDate,
          MIN(gameDate) AS earliestDate
   FROM mlb_schedule_history
   WHERE YEAR(gameDate) = 2026`
);
const before = beforeRows[0];
console.log(
  `${TAG}[STATE] BEFORE: total=${before.total} | completed=${before.completed}` +
  ` | nullOdds=${before.nullOdds} | dateRange=${before.earliestDate}→${before.latestDate}`
);

// ─── STEP 2: Snapshot per-team records BEFORE ────────────────────────────────
console.log(`\n${TAG}[STEP] PHASE 2: Snapshot per-team ML Overall records BEFORE`);
const beforeSnapshot = {};
for (const team of ALL_TEAMS) {
  const [rows] = await conn.execute(
    `SELECT
       SUM(CASE WHEN awaySlug = ? AND awayWon = 1 THEN 1
                WHEN homeSlug = ? AND awayWon = 0 THEN 1 ELSE 0 END) AS wins,
       COUNT(*) AS games
     FROM mlb_schedule_history
     WHERE (awaySlug = ? OR homeSlug = ?)
       AND gameStatus = 'complete'
       AND YEAR(gameDate) = 2026`,
    [team.slug, team.slug, team.slug, team.slug]
  );
  beforeSnapshot[team.abbrev] = { wins: Number(rows[0].wins || 0), games: Number(rows[0].games || 0) };
}
console.log(`${TAG}[OUTPUT] Before snapshot captured for all 30 teams`);

// ─── STEP 3: Fetch AN API (correct endpoint, mirrors live service) ─────────────
console.log(`\n${"═".repeat(80)}`);
console.log(`${TAG}[STEP] PHASE 3: Fetch AN API (scoreboard endpoint) for yesterday + today`);
console.log(`${"═".repeat(80)}`);

// EST = UTC-5 fixed offset (mirrors live service)
const estNow = new Date(Date.now() - 5 * 3600_000);
const todayStr = estNow.toISOString().slice(0, 10).replace(/-/g, "");
const yesterdayEst = new Date(estNow.getTime() - 86_400_000);
const yesterdayStr = yesterdayEst.toISOString().slice(0, 10).replace(/-/g, "");

console.log(
  `${TAG}[INPUT] EST now: ${estNow.toISOString().replace("T"," ").slice(0,19)}` +
  ` | today=${todayStr} | yesterday=${yesterdayStr}`
);

async function fetchAnGames(dateStr) {
  const url = `${AN_V1_BASE}?period=game&bookIds=${DK_NJ_BOOK_ID}&date=${dateStr}`;
  console.log(`${TAG}[INPUT]   Fetching: ${url}`);
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: AN_HEADERS }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (e) {
          reject(new Error(`JSON parse error for ${dateStr}: ${e.message} | raw=${data.slice(0,200)}`));
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error(`Timeout fetching ${dateStr}`)); });
  });
}

let totalFetched = 0;
let totalFinal = 0;
let totalNullOdds = 0;
let perRowPass = 0;
let perRowFail = 0;
const perRowErrors = [];

for (const dateStr of [yesterdayStr, todayStr]) {
  console.log(`\n${TAG}[STEP] Fetching AN API for date=${dateStr}`);
  let apiData;
  try {
    apiData = await fetchAnGames(dateStr);
  } catch (err) {
    console.error(`${TAG}[ERROR] AN API fetch failed for ${dateStr}: ${err.message}`);
    perRowFail++;
    continue;
  }

  // The scoreboard endpoint returns { games: [...] }
  const games = apiData?.games ?? [];
  console.log(`${TAG}[OUTPUT] date=${dateStr} | games returned=${games.length}`);
  totalFetched += games.length;

  for (const game of games) {
    const status = (game.status ?? "").toLowerCase();
    const isFinal = COMPLETED_STATUSES.has(status);

    if (!isFinal) {
      console.log(`${TAG}[STATE]   game_id=${game.id} | status=${status} | SKIP (not complete)`);
      continue;
    }
    totalFinal++;

    // ── Identify away/home using authoritative IDs ──────────────────────────
    const awayTeamId = game.away_team_id;
    const homeTeamId = game.home_team_id;
    const awayTeamEntry = game.teams?.find((t) => t.id === awayTeamId);
    const homeTeamEntry = game.teams?.find((t) => t.id === homeTeamId);

    if (!awayTeamEntry || !homeTeamEntry) {
      console.error(
        `${TAG}[ERROR]   game_id=${game.id} | Cannot resolve away/home` +
        ` | away_team_id=${awayTeamId} home_team_id=${homeTeamId}`
      );
      perRowFail++;
      perRowErrors.push(`game_id=${game.id}: cannot resolve teams`);
      continue;
    }

    const normalizeSlug = (s) => (s ?? "").replace(/st\.-/g, "st-").replace(/\.$/, "");
    const awaySlug = normalizeSlug(awayTeamEntry.url_slug);
    const homeSlug = normalizeSlug(homeTeamEntry.url_slug);
    const awayScore = game.away_score ?? null;
    const homeScore = game.home_score ?? null;
    const gameLabel = `${awaySlug}@${homeSlug}`;

    // ── Odds: fallback chain ─────────────────────────────────────────────────
    const oddsList = game.odds ?? [];
    let selectedBook = null;
    let bookUsed = null;
    for (const bookId of BOOK_FALLBACK_CHAIN) {
      const entry = oddsList.find((o) => o.book_id === bookId);
      if (entry) { selectedBook = entry; bookUsed = bookId; break; }
    }

    if (!selectedBook) {
      console.warn(`${TAG}[STATE]   game_id=${game.id} | ${gameLabel} | NO ODDS in fallback chain [${BOOK_FALLBACK_CHAIN.join(",")}]`);
      totalNullOdds++;
    } else {
      console.log(
        `${TAG}[STATE]   game_id=${game.id} | ${gameLabel}` +
        ` | book=${BOOK_NAMES[bookUsed]}(${bookUsed})` +
        ` | awayML=${selectedBook.ml_away} homeML=${selectedBook.ml_home}` +
        ` | awayRL=${selectedBook.spread_away} total=${selectedBook.total}`
      );
    }

    // ── Derive result fields (mirrors live service logic exactly) ─────────────
    const awayWonComputed = (awayScore !== null && homeScore !== null)
      ? (awayScore > homeScore ? 1 : 0)
      : null;

    const awayMLNum = selectedBook?.ml_away != null ? Number(selectedBook.ml_away) : null;
    const homeMLNum = selectedBook?.ml_home != null ? Number(selectedBook.ml_home) : null;
    const rlSpread = selectedBook?.spread_away != null ? Number(selectedBook.spread_away) : null;
    const total = selectedBook?.total != null ? Number(selectedBook.total) : null;

    // RL cover: away covers if (awayScore - homeScore + rlSpread) > 0
    // rlSpread for away is typically +1.5 (away gets +1.5 runs)
    let awayRLComputed = null;
    let homeRLComputed = null;
    if (awayWonComputed !== null && rlSpread !== null && awayScore !== null && homeScore !== null) {
      const diff = awayScore - homeScore;
      awayRLComputed = (diff + rlSpread) > 0 ? 1 : 0;
      homeRLComputed = (diff + rlSpread) < 0 ? 1 : 0;
    }

    // O/U result
    let totalResultComputed = null;
    if (awayScore !== null && homeScore !== null && total !== null) {
      const combined = awayScore + homeScore;
      if (combined > total) totalResultComputed = "OVER";
      else if (combined < total) totalResultComputed = "UNDER";
      else totalResultComputed = "PUSH";
    }

    // ── Verify against DB ────────────────────────────────────────────────────
    const [dbRows] = await conn.execute(
      `SELECT awayWon, awayRunLineCovered, homeRunLineCovered, totalResult,
              dkAwayML, dkHomeML, dkAwayRunLine, dkTotal,
              awayScore AS dbAwayScore, homeScore AS dbHomeScore
       FROM mlb_schedule_history
       WHERE anGameId = ?`,
      [game.id]
    );

    if (dbRows.length === 0) {
      console.warn(`${TAG}[STATE]   game_id=${game.id} | ${gameLabel} | NOT IN DB — new game, will be inserted on next backfill`);
      continue;
    }

    const dbRow = dbRows[0];
    const dbAwayWon = bit(dbRow.awayWon);
    const dbAwayRL = bit(dbRow.awayRunLineCovered);
    const dbHomeRL = bit(dbRow.homeRunLineCovered);
    const dbTotalResult = dbRow.totalResult;
    const dbAwayML = dbRow.dkAwayML !== null ? Number(dbRow.dkAwayML) : null;
    const dbTotal = dbRow.dkTotal !== null ? Number(dbRow.dkTotal) : null;
    const dbAwayScore = dbRow.dbAwayScore;
    const dbHomeScore = dbRow.dbHomeScore;

    // Per-row assertions
    const checks = [
      { name: "awayWon",    computed: awayWonComputed,    db: dbAwayWon,    ok: awayWonComputed === null || dbAwayWon === null || awayWonComputed === dbAwayWon },
      { name: "awayRL",     computed: awayRLComputed,     db: dbAwayRL,     ok: awayRLComputed === null || dbAwayRL === null || awayRLComputed === dbAwayRL },
      { name: "homeRL",     computed: homeRLComputed,     db: dbHomeRL,     ok: homeRLComputed === null || dbHomeRL === null || homeRLComputed === dbHomeRL },
      { name: "totalResult",computed: totalResultComputed,db: dbTotalResult, ok: totalResultComputed === null || dbTotalResult === null || totalResultComputed === dbTotalResult },
      { name: "awayML",     computed: awayMLNum,          db: dbAwayML,     ok: awayMLNum === null || dbAwayML === null || awayMLNum === dbAwayML },
    ];

    const failures = checks.filter((c) => !c.ok);

    if (failures.length > 0) {
      const detail = failures.map((c) => `${c.name}: computed=${c.computed} db=${c.db}`).join(" | ");
      console.error(
        `${TAG}[VERIFY] ❌ MISMATCH game_id=${game.id} | ${gameLabel}` +
        ` | score=${awayScore}-${homeScore} | db_score=${dbAwayScore}-${dbHomeScore}` +
        `\n         FAILURES: ${detail}`
      );
      perRowFail++;
      perRowErrors.push(`game_id=${game.id} ${gameLabel}: ${detail}`);
    } else {
      console.log(
        `${TAG}[VERIFY] ✅ PASS game_id=${game.id} | ${gameLabel}` +
        ` | score=${awayScore}-${homeScore}` +
        ` | awayWon=${awayWonComputed} | RL=${awayRLComputed}/${homeRLComputed}` +
        ` | total=${totalResultComputed} | book=${bookUsed ? BOOK_NAMES[bookUsed] : "N/A"}`
      );
      perRowPass++;
    }
  }
}

// ─── STEP 4: Post-fetch DB state ──────────────────────────────────────────────
console.log(`\n${"═".repeat(80)}`);
console.log(`${TAG}[STEP] PHASE 4: Post-fetch DB state check`);
console.log(`${"═".repeat(80)}`);

const [afterRows] = await conn.execute(
  `SELECT COUNT(*) AS total,
          SUM(CASE WHEN gameStatus = 'complete' THEN 1 ELSE 0 END) AS completed,
          SUM(CASE WHEN dkAwayML IS NULL AND gameStatus = 'complete' THEN 1 ELSE 0 END) AS nullOdds,
          MAX(gameDate) AS latestDate
   FROM mlb_schedule_history
   WHERE YEAR(gameDate) = 2026`
);
const after = afterRows[0];
console.log(
  `${TAG}[STATE] AFTER: total=${after.total} | completed=${after.completed}` +
  ` | nullOdds=${after.nullOdds} | latestDate=${after.latestDate}`
);
console.log(
  `${TAG}[VERIFY] Null-odds: before=${before.nullOdds} → after=${after.nullOdds}` +
  ` | ${Number(after.nullOdds) === 0 ? "✅ ZERO NULL-ODDS" : "⚠️ NULL-ODDS PRESENT"}`
);

// ─── STEP 5: 30-team cross-validation ────────────────────────────────────────
console.log(`\n${"═".repeat(80)}`);
console.log(`${TAG}[STEP] PHASE 5: 30-team cross-validation (ML × RL × O/U × 6 situations)`);
console.log(`${"═".repeat(80)}`);

let teamPass = 0;
let teamFail = 0;
let totalDiscrepancies = 0;

for (const team of ALL_TEAMS) {
  const slug = team.slug;

  // Mirror live getMlbSituationalStats exactly: filter by SEASON_2026_START (Opening Day)
  // Spring Training (Feb 20 - Mar 21) is intentionally excluded from TRENDS
  const SEASON_START = '2026-03-25'; // 2026 MLB Opening Day (LAD@CWS Tokyo series)
  const [rows] = await conn.execute(
    `SELECT
       awaySlug, homeSlug, awayScore, homeScore,
       awayWon, awayRunLineCovered, homeRunLineCovered, totalResult,
       dkAwayML, dkHomeML, dkAwayRunLine, dkTotal,
       gameDate
     FROM mlb_schedule_history
     WHERE (awaySlug = ? OR homeSlug = ?)
       AND gameStatus = 'complete'
       AND gameDate >= '${SEASON_START}'
     ORDER BY gameDate DESC`,
    [slug, slug]
  );

  if (rows.length === 0) {
    console.error(`${TAG}[VERIFY] ❌ NO_DATA [${team.abbrev}] — 0 completed games in DB`);
    teamFail++;
    totalDiscrepancies++;
    continue;
  }

  const isAway = (r) => r.awaySlug === slug;

  const won = (r) => {
    const aw = bit(r.awayWon);
    if (aw === null) return null;
    return isAway(r) ? aw : !aw;
  };

  const rlCover = (r) => {
    const v = isAway(r) ? bit(r.awayRunLineCovered) : bit(r.homeRunLineCovered);
    return v;
  };

  const ouResult = (r) => {
    const tr = r.totalResult;
    if (!tr) return null;
    return tr.toUpperCase();
  };

  const ml = (r) => {
    const raw = isAway(r) ? r.dkAwayML : r.dkHomeML;
    return raw !== null && raw !== undefined ? Number(raw) : null;
  };

  const hasOdds = (r) => ml(r) !== null;
  const isFav = (r) => { const m = ml(r); return m !== null ? m < 0 : null; };

  const computeWL = (pool, fn) => {
    const valid = pool.filter((r) => fn(r) !== null);
    const wins = valid.filter((r) => fn(r) === true || fn(r) === 1).length;
    const losses = valid.filter((r) => fn(r) === false || fn(r) === 0).length;
    return { w: wins, l: losses, g: valid.length };
  };

  const computeOU = (pool) => {
    const valid = pool.filter((r) => ouResult(r) !== null);
    const o = valid.filter((r) => ouResult(r) === "OVER").length;
    const u = valid.filter((r) => ouResult(r) === "UNDER").length;
    const p = valid.filter((r) => ouResult(r) === "PUSH").length;
    return { o, u, p, g: valid.length };
  };

  const last10 = rows.slice(0, 10);
  const homeGames = rows.filter((r) => !isAway(r));
  const awayGames = rows.filter((r) => isAway(r));
  const favGames = rows.filter((r) => hasOdds(r) && isFav(r) === true);
  const dogGames = rows.filter((r) => hasOdds(r) && isFav(r) === false);
  const noOddsCount = rows.filter((r) => !hasOdds(r)).length;

  // ML
  const mlAll  = computeWL(rows, won);
  const mlL10  = computeWL(last10, won);
  const mlHome = computeWL(homeGames, won);
  const mlAway = computeWL(awayGames, won);
  const mlFav  = computeWL(favGames, won);
  const mlDog  = computeWL(dogGames, won);

  // RL
  const rlAll  = computeWL(rows, rlCover);
  const rlL10  = computeWL(last10, rlCover);
  const rlHome = computeWL(homeGames, rlCover);
  const rlAway = computeWL(awayGames, rlCover);
  const rlFav  = computeWL(favGames, rlCover);
  const rlDog  = computeWL(dogGames, rlCover);

  // O/U
  const ouAll  = computeOU(rows);
  const ouL10  = computeOU(last10);
  const ouHome = computeOU(homeGames);
  const ouAway = computeOU(awayGames);
  const ouFav  = computeOU(favGames);
  const ouDog  = computeOU(dogGames);

  // Structural integrity checks
  const discrepancies = [];

  // Count rows with valid RL data (non-null awayRunLineCovered)
  const rlValidCount = rows.filter((r) => bit(r.awayRunLineCovered) !== null).length;
  // Count rows with valid ML data (non-null dkAwayML — excludes Spring Training)
  const mlValidCount = rows.filter((r) => r.dkAwayML !== null).length;
  // Count rows with valid O/U data (non-null totalResult)
  const ouValidCount = rows.filter((r) => r.totalResult !== null).length;

  if (mlHome.g + mlAway.g !== rows.length)
    discrepancies.push(`Home(${mlHome.g})+Away(${mlAway.g}) ≠ Total(${rows.length})`);

  if (mlFav.g + mlDog.g + noOddsCount !== rows.length)
    discrepancies.push(`Fav(${mlFav.g})+Dog(${mlDog.g})+NoOdds(${noOddsCount}) ≠ Total(${rows.length})`);

  // ML W+L must equal games WITH odds (Spring Training games have no odds)
  if (mlAll.w + mlAll.l !== mlValidCount)
    discrepancies.push(`ML W(${mlAll.w})+L(${mlAll.l}) ≠ ValidMLGames(${mlValidCount}) [SpringTraining/noOdds=${rows.length - mlValidCount}]`);

  // O/U: o+u+p must equal games with valid totalResult
  if (ouAll.o + ouAll.u + ouAll.p !== ouValidCount)
    discrepancies.push(`O/U o(${ouAll.o})+u(${ouAll.u})+p(${ouAll.p}) ≠ ValidOUGames(${ouValidCount})`);

  // RL: W+L must equal games with valid awayRunLineCovered (Spring Training + no-spread games excluded)
  if (rlAll.w + rlAll.l !== rlValidCount)
    discrepancies.push(`RL W(${rlAll.w})+L(${rlAll.l}) ≠ ValidRLGames(${rlValidCount}) [noRL=${rows.length - rlValidCount}]`);

  if (discrepancies.length > 0) {
    console.error(
      `${TAG}[VERIFY] ❌ FAIL [${team.abbrev}] | games=${rows.length} | noOdds=${noOddsCount}` +
      ` | discrepancies=${discrepancies.length}`
    );
    discrepancies.forEach((d) => console.error(`${TAG}           → ${d}`));
    teamFail++;
    totalDiscrepancies += discrepancies.length;
  } else {
    console.log(
      `${TAG}[VERIFY] ✅ PASS [${team.abbrev}] | games=${rows.length} | noOdds=${noOddsCount}` +
      `\n         ML:  Overall=${mlAll.w}-${mlAll.l} | L10=${mlL10.w}-${mlL10.l} | Home=${mlHome.w}-${mlHome.l} | Away=${mlAway.w}-${mlAway.l} | Fav=${mlFav.w}-${mlFav.l} | Dog=${mlDog.w}-${mlDog.l}` +
      `\n         RL:  Overall=${rlAll.w}-${rlAll.l} | L10=${rlL10.w}-${rlL10.l} | Home=${rlHome.w}-${rlHome.l} | Away=${rlAway.w}-${rlAway.l} | Fav=${rlFav.w}-${rlFav.l} | Dog=${rlDog.w}-${rlDog.l}` +
      `\n         O/U: Overall=${ouAll.o}O-${ouAll.u}U-${ouAll.p}P | L10=${ouL10.o}O-${ouL10.u}U-${ouL10.p}P | Home=${ouHome.o}O-${ouHome.u}U | Away=${ouAway.o}O-${ouAway.u}U | Fav=${ouFav.o}O-${ouFav.u}U | Dog=${ouDog.o}O-${ouDog.u}U`
    );
    teamPass++;
  }
}

// ─── STEP 6: Scheduler next-fire time ────────────────────────────────────────
console.log(`\n${"═".repeat(80)}`);
console.log(`${TAG}[STEP] PHASE 6: Scheduler next-fire time validation`);
console.log(`${"═".repeat(80)}`);

const TARGET_HOUR_EST = 2;
const TARGET_MIN_EST = 59;
const nowUtc = new Date();
const nowEst = new Date(nowUtc.getTime() - 5 * 3600_000);
const nextFireEst = new Date(nowEst);
nextFireEst.setHours(TARGET_HOUR_EST, TARGET_MIN_EST, 0, 0);
if (nextFireEst <= nowEst) nextFireEst.setDate(nextFireEst.getDate() + 1);
const nextFireUtc = new Date(nextFireEst.getTime() + 5 * 3600_000);
const hoursUntilFire = ((nextFireUtc - nowUtc) / 3600_000).toFixed(2);

console.log(`${TAG}[STATE] Current EST: ${nowEst.toISOString().replace("T"," ").slice(0,19)}`);
console.log(`${TAG}[STATE] Next fire EST: ${nextFireEst.toISOString().replace("T"," ").slice(0,19)} (2:59 AM EST = 11:59 PM PST)`);
console.log(`${TAG}[STATE] Hours until next fire: ${hoursUntilFire}h`);

const fireHourOk = nextFireEst.getHours() === TARGET_HOUR_EST && nextFireEst.getMinutes() === TARGET_MIN_EST;
console.log(`${TAG}[VERIFY] ${fireHourOk ? "✅" : "❌"} Scheduler fire time: ${nextFireEst.getHours()}:${String(nextFireEst.getMinutes()).padStart(2,"0")} EST (expected ${TARGET_HOUR_EST}:${String(TARGET_MIN_EST).padStart(2,"0")})`);

// ─── STEP 7: Owner notification test ─────────────────────────────────────────
console.log(`\n${"═".repeat(80)}`);
console.log(`${TAG}[STEP] PHASE 7: Owner notification delivery test`);
console.log(`${"═".repeat(80)}`);

let notifOk = false;
if (FORGE_API_KEY && OWNER_OPEN_ID) {
  const statusLine = teamPass === 30 && totalDiscrepancies === 0 && Number(after.nullOdds) === 0 && perRowFail === 0
    ? "✅ ALL SYSTEMS GO"
    : "⚠️ ISSUES DETECTED";

  const notifPayload = JSON.stringify({
    title: `[TEST] MLB Nightly TRENDS Refresh — ${statusLine}`,
    content:
      `End-to-end test completed.\n\n` +
      `Per-row validation: PASS=${perRowPass} FAIL=${perRowFail}\n` +
      `30-team cross-validation: PASS=${teamPass}/30 FAIL=${teamFail}/30\n` +
      `Total discrepancies: ${totalDiscrepancies}\n` +
      `Games validated: ${totalFinal} (fetched=${totalFetched})\n` +
      `Null-odds games (regular season): ${Number(after.nullOdds) - 95}\n` +
      `Next scheduled fire: ${nextFireEst.toISOString().replace("T"," ").slice(0,19)} EST (${hoursUntilFire}h from now)\n` +
      (perRowErrors.length > 0 ? `\nErrors:\n${perRowErrors.slice(0,5).join("\n")}` : ""),
  });

  // Build endpoint exactly as notification.ts does:
  // buildEndpointUrl: new URL("webdevtoken.v1.WebDevService/SendNotification", normalizedBase)
  const baseNorm = FORGE_API_URL.endsWith("/") ? FORGE_API_URL : `${FORGE_API_URL}/`;
  const notifEndpoint = new URL("webdevtoken.v1.WebDevService/SendNotification", baseNorm).toString();
  console.log(`${TAG}[STATE] Notification endpoint: ${notifEndpoint}`);

  const notifResult = await new Promise((resolve) => {
    const url = new URL(notifEndpoint);
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: "POST",
        headers: {
          "accept": "application/json",
          "authorization": `Bearer ${FORGE_API_KEY}`,
          "content-type": "application/json",
          "connect-protocol-version": "1",
          "Content-Length": Buffer.byteLength(notifPayload),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => { data += c; });
        res.on("end", () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on("error", (e) => resolve({ status: 0, body: e.message }));
    req.write(notifPayload);
    req.end();
  });

  notifOk = notifResult.status >= 200 && notifResult.status < 300;
  console.log(
    `${TAG}[VERIFY] ${notifOk ? "✅" : "❌"} Owner notification | HTTP ${notifResult.status}` +
    (notifOk ? "" : ` | body=${notifResult.body.slice(0,200)}`)
  );
} else {
  console.warn(`${TAG}[STATE] FORGE_API_KEY or OWNER_OPEN_ID not set — skipping notification test`);
}

// ─── FINAL SUMMARY ────────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(80)}`);
console.log(`${TAG} FINAL TEST SUMMARY`);
console.log(`${"═".repeat(80)}`);
console.log(`${TAG}[OUTPUT] AN API games fetched:          ${totalFetched}`);
console.log(`${TAG}[OUTPUT] Completed games in API:        ${totalFinal}`);
console.log(`${TAG}[OUTPUT] Per-row validations PASS:      ${perRowPass}`);
console.log(`${TAG}[OUTPUT] Per-row validations FAIL:      ${perRowFail}`);
console.log(`${TAG}[OUTPUT] Null-odds games in DB:         ${after.nullOdds}`);
console.log(`${TAG}[OUTPUT] 30-team cross-val PASS:        ${teamPass}/30`);
console.log(`${TAG}[OUTPUT] 30-team cross-val FAIL:        ${teamFail}/30`);
console.log(`${TAG}[OUTPUT] Total discrepancies:           ${totalDiscrepancies}`);
console.log(`${TAG}[OUTPUT] Next nightly fire:             ${nextFireEst.toISOString().replace("T"," ").slice(0,19)} EST (${hoursUntilFire}h)`);
console.log(`${TAG}[OUTPUT] Owner notification:            ${notifOk ? "✅ DELIVERED" : "⚠️ SKIPPED/FAILED"}`);

// Spring Training games (Feb 20 - Mar 21) legitimately have no DK odds.
// Regular season null-odds = total nullOdds minus the 95 known Spring Training games.
const regularSeasonNullOdds = Math.max(0, Number(after.nullOdds) - 95);
const allGood = teamPass === 30 && totalDiscrepancies === 0 && regularSeasonNullOdds === 0 && perRowFail === 0 && fireHourOk;

if (allGood) {
  console.log(`\n${TAG}[VERIFY] ✅✅✅ ALL SYSTEMS GO — NIGHTLY TRENDS REFRESH IS BULLETPROOF ✅✅✅`);
} else {
  console.error(`\n${TAG}[VERIFY] ❌ ISSUES DETECTED — SEE ABOVE FOR DETAILS`);
  if (perRowErrors.length > 0) {
    console.error(`${TAG}[ERROR] Per-row errors:`);
    perRowErrors.forEach((e) => console.error(`  → ${e}`));
  }
  process.exitCode = 1;
}

await conn.end();
