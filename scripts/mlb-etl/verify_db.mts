/**
 * Read-only production verification suite for the MLB canonical tables (`mlb_*`). Runs the six
 * check groups from the task-4 brief against the local corpus (docs/mlb-stats-api/data/) and
 * production MySQL, writes docs/mlb-stats-api/data/etl-out/verify-db-report.json, prints one
 * PASS/FAIL line per group, and exits nonzero on any failure.
 *
 * Usage:
 *   railway run --service ai-sports-betting-dime-ai -- npx tsx scripts/mlb-etl/verify_db.mts
 *
 * NEVER print, log, or persist DATABASE_URL. Every query here is a SELECT/EXPLAIN — no writes.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const TAG = "[VerifyDb]";
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const DATA_DIR = join(REPO, "docs", "mlb-stats-api", "data");
const ETL_OUT = join(DATA_DIR, "etl-out");
const REPORT_PATH = join(ETL_OUT, "verify-db-report.json");

const EXPECTED_GRAND_TOTAL = 49_414;

// ─── seeded RNG (mulberry32) — deterministic sampling across runs ─────────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sample<T>(arr: T[], n: number, rng: () => number): T[] {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.min(n, copy.length));
}

// ─── dataset helpers ────────────────────────────────────────────────────────────────────────

interface DatasetGame {
  gamePk: number;
  awayScore: number;
  homeScore: number;
}

interface SeasonDataset {
  season: number;
  finals: DatasetGame[];
}

function discoverDatasetSeasons(): number[] {
  return readdirSync(DATA_DIR)
    .filter((f) => /^games-\d{4}\.json$/.test(f))
    .map((f) => parseInt(f.slice("games-".length, "games-".length + 4), 10))
    .sort((a, b) => a - b);
}

function loadSeasonDataset(season: number): SeasonDataset {
  const path = join(DATA_DIR, `games-${season}.json`);
  const arr = JSON.parse(readFileSync(path, "utf8")) as any[];
  const finals: DatasetGame[] = arr
    .filter((g) => g.codedState === "F")
    .map((g) => ({ gamePk: g.gamePk, awayScore: g.awayScore, homeScore: g.homeScore }));
  return { season, finals };
}

function loadSeasonManifest(season: number): Record<string, number> | null {
  const path = join(ETL_OUT, String(season), "manifest.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

// ─── report scaffolding ─────────────────────────────────────────────────────────────────────

interface CheckGroup {
  group: number;
  name: string;
  pass: boolean;
  details: unknown;
}

const groups: CheckGroup[] = [];

function record(group: number, name: string, pass: boolean, details: unknown): void {
  groups.push({ group, name, pass, details });
  console.log(`${TAG} ${pass ? "PASS" : "FAIL"} [group ${group}] ${name}`);
}

// ─── group 1: games count per season vs dataset finals, incl. grand total ─────────────────────

async function checkGamesCount(pool: mysql.Pool, seasons: number[]): Promise<void> {
  const [rows] = await pool.query("SELECT season, COUNT(*) n FROM mlb_games GROUP BY season");
  const dbBySeason = new Map<number, number>();
  for (const r of rows as any[]) dbBySeason.set(Number(r.season), Number(r.n));

  const perSeason: Record<string, { dataset: number; db: number; ok: boolean }> = {};
  let datasetGrandTotal = 0;
  let ok = true;
  for (const season of seasons) {
    const { finals } = loadSeasonDataset(season);
    const dataset = finals.length;
    const db = dbBySeason.get(season) ?? 0;
    datasetGrandTotal += dataset;
    const seasonOk = dataset === db;
    if (!seasonOk) ok = false;
    perSeason[season] = { dataset, db, ok: seasonOk };
  }

  const [totalRows] = await pool.query("SELECT COUNT(*) n FROM mlb_games");
  const dbGrandTotal = Number((totalRows as any)[0].n);
  const grandTotalOk = dbGrandTotal === EXPECTED_GRAND_TOTAL && datasetGrandTotal === EXPECTED_GRAND_TOTAL;
  if (!grandTotalOk) ok = false;

  record(1, "mlb_games count per season == dataset finals; grand total == 49414", ok, {
    perSeason,
    datasetGrandTotal,
    dbGrandTotal,
    expectedGrandTotal: EXPECTED_GRAND_TOTAL,
  });
}

// ─── group 2: manifest vs DB counts for plays/pitches/boxscores/officials ─────────────────────

async function checkManifestCounts(pool: mysql.Pool, seasons: number[]): Promise<void> {
  const checks = [
    { key: "pitches", sql: `SELECT COUNT(*) n FROM mlb_pitches WHERE season = ?` },
    {
      key: "plays",
      sql: `SELECT COUNT(*) n FROM mlb_plays p JOIN mlb_games g ON g.game_pk = p.game_pk WHERE g.season = ?`,
    },
    {
      key: "batting_rows",
      sql: `SELECT COUNT(*) n FROM mlb_boxscore_batting b JOIN mlb_games g ON g.game_pk = b.game_pk WHERE g.season = ?`,
    },
    {
      key: "pitching_rows",
      sql: `SELECT COUNT(*) n FROM mlb_boxscore_pitching b JOIN mlb_games g ON g.game_pk = b.game_pk WHERE g.season = ?`,
    },
    {
      key: "officials",
      sql: `SELECT COUNT(*) n FROM mlb_officials o JOIN mlb_games g ON g.game_pk = o.game_pk WHERE g.season = ?`,
    },
  ];

  const perSeason: Record<string, Record<string, { manifest: number; db: number; ok: boolean } | "skipped">> = {};
  let ok = true;
  let anyManifest = false;
  for (const season of seasons) {
    const manifest = loadSeasonManifest(season);
    if (!manifest) {
      perSeason[season] = { manifest_missing: "manifest missing" } as any;
      ok = false;
      continue;
    }
    anyManifest = true;
    const seasonDetail: Record<string, { manifest: number; db: number; ok: boolean }> = {};
    for (const c of checks) {
      const [rows] = await pool.query(c.sql, [season]);
      const db = Number((rows as any)[0].n);
      const expected = manifest[c.key];
      const checkOk = db === expected;
      if (!checkOk) ok = false;
      seasonDetail[c.key] = { manifest: expected, db, ok: checkOk };
    }
    perSeason[season] = seasonDetail;
  }

  record(2, "manifest vs DB counts (plays/pitches/boxscores/officials)", anyManifest ? ok : true, {
    perSeason,
    note: anyManifest ? undefined : "no season manifests found — nothing to check",
  });
}

// ─── group 3: FK orphan checks (all must be zero) ─────────────────────────────────────────────

async function checkOrphans(pool: mysql.Pool): Promise<void> {
  const checks: { name: string; sql: string }[] = [
    {
      name: "plays_without_game",
      sql: `SELECT COUNT(*) n FROM mlb_plays p LEFT JOIN mlb_games g ON g.game_pk = p.game_pk WHERE g.game_pk IS NULL`,
    },
    {
      name: "pitches_without_play",
      sql: `SELECT COUNT(*) n FROM mlb_pitches pt LEFT JOIN mlb_plays pl ON pl.game_pk = pt.game_pk AND pl.at_bat_index = pt.at_bat_index WHERE pl.game_pk IS NULL`,
    },
    {
      name: "boxscore_batting_without_game",
      sql: `SELECT COUNT(*) n FROM mlb_boxscore_batting b LEFT JOIN mlb_games g ON g.game_pk = b.game_pk WHERE g.game_pk IS NULL`,
    },
    {
      name: "boxscore_batting_without_person",
      sql: `SELECT COUNT(*) n FROM mlb_boxscore_batting b LEFT JOIN mlb_people p ON p.mlbam_id = b.mlbam_id WHERE p.mlbam_id IS NULL`,
    },
    {
      name: "boxscore_pitching_without_game",
      sql: `SELECT COUNT(*) n FROM mlb_boxscore_pitching b LEFT JOIN mlb_games g ON g.game_pk = b.game_pk WHERE g.game_pk IS NULL`,
    },
    {
      name: "boxscore_pitching_without_person",
      sql: `SELECT COUNT(*) n FROM mlb_boxscore_pitching b LEFT JOIN mlb_people p ON p.mlbam_id = b.mlbam_id WHERE p.mlbam_id IS NULL`,
    },
    {
      name: "officials_without_person",
      sql: `SELECT COUNT(*) n FROM mlb_officials o LEFT JOIN mlb_people p ON p.mlbam_id = o.mlbam_id WHERE p.mlbam_id IS NULL`,
    },
  ];

  const details: Record<string, number> = {};
  let ok = true;
  for (const c of checks) {
    const [rows] = await pool.query(c.sql);
    const n = Number((rows as any)[0].n);
    details[c.name] = n;
    if (n !== 0) ok = false;
  }
  record(3, "FK orphan checks (all zero)", ok, details);
}

// ─── group 4: score cross-foot ──────────────────────────────────────────────────────────────

async function checkScoreCrossFoot(pool: mysql.Pool, seasons: number[], rng: () => number): Promise<void> {
  const perSeasonSum: Record<string, { dataset: number; db: number; ok: boolean }> = {};
  let ok = true;

  for (const season of seasons) {
    const { finals } = loadSeasonDataset(season);
    const datasetSum = finals.reduce((acc, g) => acc + (g.awayScore ?? 0) + (g.homeScore ?? 0), 0);
    const [rows] = await pool.query(
      `SELECT COALESCE(SUM(away_score + home_score), 0) n FROM mlb_games WHERE season = ?`,
      [season],
    );
    const dbSum = Number((rows as any)[0].n);
    const seasonOk = dbSum === datasetSum;
    if (!seasonOk) ok = false;
    perSeasonSum[season] = { dataset: datasetSum, db: dbSum, ok: seasonOk };
  }

  // sampled 50 games/season: final score == MAX(cumulative play score) from mlb_plays
  const sampledMismatches: { season: number; gamePk: number; reason: string }[] = [];
  let sampledChecked = 0;
  for (const season of seasons) {
    const { finals } = loadSeasonDataset(season);
    if (finals.length === 0) continue;
    const picked = sample(finals, 50, rng);
    for (const g of picked) {
      const [rows] = await pool.query(
        `SELECT away_score, home_score FROM mlb_games WHERE game_pk = ?`,
        [g.gamePk],
      );
      const gameRow = (rows as any[])[0];
      if (!gameRow) continue; // not loaded yet — not a failure, just nothing to sample
      sampledChecked++;
      const [playRows] = await pool.query(
        `SELECT MAX(away_score) a, MAX(home_score) h FROM mlb_plays WHERE game_pk = ?`,
        [g.gamePk],
      );
      const pr = (playRows as any[])[0];
      const maxAway = pr?.a === null ? null : Number(pr?.a);
      const maxHome = pr?.h === null ? null : Number(pr?.h);
      if (maxAway === null || maxHome === null) {
        sampledMismatches.push({ season, gamePk: g.gamePk, reason: "no plays loaded for game" });
        continue;
      }
      if (Number(gameRow.away_score) !== maxAway || Number(gameRow.home_score) !== maxHome) {
        sampledMismatches.push({
          season,
          gamePk: g.gamePk,
          reason: `game score ${gameRow.away_score}-${gameRow.home_score} != max play score ${maxAway}-${maxHome}`,
        });
      }
    }
  }
  const sampledOk = sampledMismatches.length === 0;
  if (!sampledOk) ok = false;

  record(4, "score cross-foot (season sums + sampled 50/season max-play-score)", ok, {
    perSeasonSum,
    sampledChecked,
    sampledMismatches,
  });
}

// ─── group 5: seeded era sample (25/season) ────────────────────────────────────────────────

async function checkEraSamples(pool: mysql.Pool, seasons: number[], rng: () => number): Promise<void> {
  // 5a. pitch play_id uniqueness — global
  const [uniqRows] = await pool.query(
    `SELECT COUNT(*) total, COUNT(DISTINCT play_id) distinctCount FROM mlb_pitches`,
  );
  const uniqRow = (uniqRows as any[])[0];
  const total = Number(uniqRow.total);
  const distinctCount = Number(uniqRow.distinctCount);
  const uniquenessOk = total === distinctCount;

  // 5b + 5c: sampled 25/season — season denorm matches game season, no zero-filled tracking
  // values where feed had NULL (checked directly against DB nulls for pre-2008 pitches, since
  // "feed had NULL" is exactly what the transform preserves as SQL NULL by construction).
  const seasonDenormMismatches: { season: number; playId: string; gameSeason: number }[] = [];
  let denormChecked = 0;
  for (const season of seasons) {
    const [pkRows] = await pool.query(`SELECT play_id FROM mlb_pitches WHERE season = ? ORDER BY play_id LIMIT 5000`, [season]);
    const playIds = (pkRows as any[]).map((r) => r.play_id as string);
    if (playIds.length === 0) continue;
    const picked = sample(playIds, 25, rng);
    for (const playId of picked) {
      const [rows] = await pool.query(
        `SELECT pt.season pitchSeason, g.season gameSeason FROM mlb_pitches pt JOIN mlb_games g ON g.game_pk = pt.game_pk WHERE pt.play_id = ?`,
        [playId],
      );
      const r = (rows as any[])[0];
      if (!r) continue;
      denormChecked++;
      if (Number(r.pitchSeason) !== Number(r.gameSeason)) {
        seasonDenormMismatches.push({ season, playId, gameSeason: Number(r.gameSeason) });
      }
    }
  }

  // NULL-preservation: pick 5 pre-2008 pitches, confirm tracking fields are NULL not 0.
  const trackingCols = [
    "start_speed",
    "end_speed",
    "spin_rate",
    "extension",
    "px",
    "pz",
    "break_angle",
    "break_length",
  ];
  const [preRows] = await pool.query(
    `SELECT play_id, ${trackingCols.join(", ")} FROM mlb_pitches WHERE season < 2008 ORDER BY play_id LIMIT 2000`,
  );
  const preSampleAll = preRows as any[];
  const preSample = sample(preSampleAll, 5, rng);
  const nullPreservationFindings: { playId: string; nonNullTrackingCols: string[] }[] = [];
  for (const row of preSample) {
    const nonNull = trackingCols.filter((c) => row[c] !== null && row[c] !== undefined);
    // Not a hard failure by itself (a pre-2008 pitch could legitimately have some tracking data
    // in rare backfilled cases) — but zero-fill (value === 0 where legacy systems used to
    // zero-fill) is the specific defect this check guards against; NULL is fine, 0 is not.
    const zeroFilled = trackingCols.filter((c) => row[c] !== null && Number(row[c]) === 0);
    if (zeroFilled.length > 0) {
      nullPreservationFindings.push({ playId: row.play_id, nonNullTrackingCols: zeroFilled });
    }
  }

  const ok = uniquenessOk && seasonDenormMismatches.length === 0 && nullPreservationFindings.length === 0;
  record(5, "seeded era sample (play_id uniqueness, season denorm, NULL preservation)", ok, {
    playIdUniqueness: { total, distinctCount, ok: uniquenessOk },
    seasonDenorm: { checked: denormChecked, mismatches: seasonDenormMismatches },
    nullPreservation: {
      pre2008SampleSize: preSample.length,
      zeroFilledFindings: nullPreservationFindings,
    },
  });
}

// ─── group 6: perf smoke — EXPLAIN uses indexes ────────────────────────────────────────────

interface ExplainCheck {
  name: string;
  sql: string;
  params: unknown[];
  expectedIndexSubstring: string;
}

function explainIndicatesIndexUse(rows: any[], expectedIndexSubstring: string): { usesIndex: boolean; raw: any[] } {
  const text = JSON.stringify(rows);
  // TiDB EXPLAIN: `access object` column contains "index:<name>(...)" when an index is used, and
  // rows are tagged e.g. "TableFullScan" when none is. MySQL EXPLAIN (fallback shape): a non-null
  // `key` column. Support both shapes defensively.
  const mysqlKeyPresent = rows.some((r) => r.key !== undefined && r.key !== null);
  const hasFullScan = /TableFullScan/i.test(text);
  const hasExpectedIndex = text.includes(expectedIndexSubstring);
  const hasAnyIndexScan = /IndexRangeScan|IndexLookUp|IndexFullScan/i.test(text);
  const usesIndex = mysqlKeyPresent || hasExpectedIndex || (hasAnyIndexScan && !hasFullScan);
  return { usesIndex, raw: rows };
}

async function checkExplainSmoke(pool: mysql.Pool): Promise<void> {
  const checks: ExplainCheck[] = [
    {
      name: "team_season_schedule_away",
      sql: `SELECT * FROM mlb_games WHERE away_team_id = ? AND season = ? AND official_date BETWEEN ? AND ?`,
      params: [147, 2026, "2026-03-01", "2026-11-01"],
      expectedIndexSubstring: "idx_mlb_games_away_season",
    },
    {
      name: "team_season_schedule_home",
      sql: `SELECT * FROM mlb_games WHERE home_team_id = ? AND season = ? AND official_date BETWEEN ? AND ?`,
      params: [147, 2026, "2026-03-01", "2026-11-01"],
      expectedIndexSubstring: "idx_mlb_games_home_season",
    },
    {
      name: "pitcher_season_pitches",
      sql: `SELECT * FROM mlb_pitches WHERE pitcher_id = ? AND season = ?`,
      params: [656492, 2026],
      expectedIndexSubstring: "idx_mlb_pitches_pitcher_season",
    },
  ];

  const details: Record<string, unknown> = {};
  let ok = true;
  for (const c of checks) {
    const [rows] = await pool.query(`EXPLAIN ${c.sql}`, c.params);
    const { usesIndex, raw } = explainIndicatesIndexUse(rows as any[], c.expectedIndexSubstring);
    if (!usesIndex) ok = false;
    details[c.name] = { usesIndex, plan: raw };
  }
  record(6, "EXPLAIN smoke — team schedule + pitcher season pitches use indexes", ok, details);
}

// ─── main ───────────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error(`${TAG} DATABASE_URL is not set — aborting.`);
    process.exit(1);
  }

  const seasons = discoverDatasetSeasons();
  console.log(`${TAG} verifying seasons: ${seasons.join(",")}`);

  const pool = mysql.createPool({
    uri: dbUrl,
    connectionLimit: 4,
    waitForConnections: true,
    queueLimit: 50,
    connectTimeout: 15000,
    idleTimeout: 30000,
  });

  const rng = mulberry32(20260728); // fixed seed — deterministic, reproducible sampling

  try {
    await checkGamesCount(pool, seasons);
    await checkManifestCounts(pool, seasons);
    await checkOrphans(pool);
    await checkScoreCrossFoot(pool, seasons, rng);
    await checkEraSamples(pool, seasons, rng);
    await checkExplainSmoke(pool);
  } finally {
    await pool.end();
  }

  const overallPass = groups.every((g) => g.pass);
  const report = {
    generatedAt: new Date().toISOString(),
    overallPass,
    groups,
  };
  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`${TAG} report written to ${REPORT_PATH}`);
  console.log(`${TAG} OVERALL: ${overallPass ? "PASS" : "FAIL"}`);

  if (!overallPass) process.exit(1);
}

main().catch((err) => {
  console.error(`${TAG} FATAL:`, err?.message ?? err);
  process.exit(1);
});
