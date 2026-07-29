/**
 * Nightly canonical MLB delta refresh — orchestrates a full pull → crawl → transform → load →
 * verify cycle for whatever finals are missing from `mlb_games` for the current season, without
 * ever downloading the full ~1,600-feed corpus. Designed to run on a GitHub Actions runner that
 * starts with an EMPTY docs/mlb-stats-api/data/feeds-2026/ (gitignored) every time — so the crawl
 * step here always targets only the missing gamePks (via crawl_feeds.py --shard), never a full
 * season crawl.
 *
 * Steps:
 *   (a) rebuild docs/mlb-stats-api/data/games-2026.json from statsapi (build_games_dataset.py)
 *   (b) read the refreshed finals (codedState F/O)
 *   (c) diff against `SELECT game_pk FROM mlb_games WHERE season = 2026` — if nothing is
 *       missing, log "up to date" and exit 0
 *   (d) write a temp shard file with just the missing gamePks and crawl only those feeds
 *       (crawl_feeds.py --shard; idempotent — a developer machine that already has every final
 *       feed on disk degenerates gracefully, since crawl_feeds.py skips files that already
 *       validate against their gamePk)
 *   (e) transform.py --season 2026 (feeds → NDJSON; on a fresh runner this only ever sees the
 *       missing feeds, which is exactly what makes this a delta load)
 *   (f) load.mts --season 2026 --delta (batched upsert; delta-scoped sanity check)
 *   (g) inline delta verification: FK orphan checks + score cross-foot vs games-2026.json,
 *       scoped to the missing gamePks
 *
 * Usage:
 *   railway run --service ai-sports-betting-dime-ai -- npx tsx scripts/mlb-etl/refresh_canonical.mts
 *
 * NEVER print, log, or persist DATABASE_URL.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const TAG = "[RefreshCanonical]";
const SEASON = 2026;
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const DATA_DIR = join(REPO, "docs", "mlb-stats-api", "data");
const CRAWL_DIR = join(REPO, "scripts", "mlb-crawl");
const ETL_DIR = join(REPO, "scripts", "mlb-etl");
const FINAL_STATES = new Set(["F", "O"]);

function log(...args: unknown[]): void {
  console.log(TAG, ...args);
}

/** Runs a child process with inherited stdio (so its own logs stream straight into ours) and
 * throws on any nonzero exit or spawn failure. Env is inherited from the parent process
 * (including DATABASE_URL for the load.mts step) — never logged here. */
function run(label: string, cmd: string, args: string[]): void {
  log(`[STEP] ${label}: ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, { cwd: REPO, stdio: "inherit" });
  if (result.error) {
    throw new Error(`${label} failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${label} exited with code ${result.status}`);
  }
}

export interface DatasetGame {
  gamePk: number;
  officialDate: string;
  codedState: string;
  awayScore: number | null;
  homeScore: number | null;
}

/** Pure diff at the heart of the delta refresh: which dataset finals aren't in `mlb_games` yet.
 * Exported (and unit-tested in refresh_canonical.test.ts) so the one piece of real branching
 * logic here — "what's missing" — has coverage independent of a live DB/network run. */
export function computeMissingGames(finals: DatasetGame[], dbGamePks: Set<number>): DatasetGame[] {
  return finals.filter((g) => !dbGamePks.has(g.gamePk));
}

function loadDatasetFinals(): DatasetGame[] {
  const path = join(DATA_DIR, `games-${SEASON}.json`);
  const rows = JSON.parse(readFileSync(path, "utf8")) as any[];
  return rows
    .filter((g) => FINAL_STATES.has(g.codedState))
    .map((g) => ({
      gamePk: g.gamePk,
      officialDate: g.officialDate,
      codedState: g.codedState,
      awayScore: g.awayScore,
      homeScore: g.homeScore,
    }));
}

async function loadDbGamePks(pool: mysql.Pool): Promise<Set<number>> {
  const [rows] = await pool.query("SELECT game_pk FROM mlb_games WHERE season = ?", [SEASON]);
  return new Set((rows as any[]).map((r) => Number(r.game_pk)));
}

/** Writes the missing games as a shard file crawl_feeds.py --shard can consume. shards/ is
 * entirely gitignored (scripts/mlb-crawl/.gitignore), and the file is removed again once the
 * crawl step finishes (success or failure) — it is purely a hand-off, not a data product. */
function writeDeltaShard(missing: DatasetGame[]): string {
  const shardDir = join(CRAWL_DIR, "shards");
  mkdirSync(shardDir, { recursive: true });
  const path = join(shardDir, `delta-${Date.now()}.json`);
  const rows = missing.map((g) => ({
    gamePk: g.gamePk,
    officialDate: g.officialDate,
    awayScore: g.awayScore,
    homeScore: g.homeScore,
  }));
  writeFileSync(path, JSON.stringify(rows));
  return path;
}

/** Inline delta verification: FK orphan checks + score cross-foot, both scoped to `pks` (the
 * gamePks this run just loaded). Mirrors verify_db.mts groups 3 + 4, but scoped rather than
 * whole-corpus so it stays cheap on every nightly run. Returns false (never throws) so the
 * caller can log a clean summary before deciding whether to fail the run. */
async function deltaVerify(pool: mysql.Pool, pks: number[], datasetByPk: Map<number, DatasetGame>): Promise<boolean> {
  if (pks.length === 0) return true;
  let ok = true;

  const orphanChecks: { name: string; sql: string }[] = [
    {
      name: "plays_without_game",
      sql: `SELECT COUNT(*) n FROM mlb_plays p LEFT JOIN mlb_games g ON g.game_pk = p.game_pk WHERE p.game_pk IN (?) AND g.game_pk IS NULL`,
    },
    {
      name: "pitches_without_play",
      sql: `SELECT COUNT(*) n FROM mlb_pitches pt LEFT JOIN mlb_plays pl ON pl.game_pk = pt.game_pk AND pl.at_bat_index = pt.at_bat_index WHERE pt.game_pk IN (?) AND pl.game_pk IS NULL`,
    },
    {
      name: "boxscore_batting_without_game",
      sql: `SELECT COUNT(*) n FROM mlb_boxscore_batting b LEFT JOIN mlb_games g ON g.game_pk = b.game_pk WHERE b.game_pk IN (?) AND g.game_pk IS NULL`,
    },
    {
      name: "boxscore_batting_without_person",
      sql: `SELECT COUNT(*) n FROM mlb_boxscore_batting b LEFT JOIN mlb_people p ON p.mlbam_id = b.mlbam_id WHERE b.game_pk IN (?) AND p.mlbam_id IS NULL`,
    },
    {
      name: "boxscore_pitching_without_game",
      sql: `SELECT COUNT(*) n FROM mlb_boxscore_pitching b LEFT JOIN mlb_games g ON g.game_pk = b.game_pk WHERE b.game_pk IN (?) AND g.game_pk IS NULL`,
    },
    {
      name: "boxscore_pitching_without_person",
      sql: `SELECT COUNT(*) n FROM mlb_boxscore_pitching b LEFT JOIN mlb_people p ON p.mlbam_id = b.mlbam_id WHERE b.game_pk IN (?) AND p.mlbam_id IS NULL`,
    },
    {
      name: "officials_without_person",
      sql: `SELECT COUNT(*) n FROM mlb_officials o LEFT JOIN mlb_people p ON p.mlbam_id = o.mlbam_id WHERE o.game_pk IN (?) AND p.mlbam_id IS NULL`,
    },
  ];

  for (const c of orphanChecks) {
    const [rows] = await pool.query(c.sql, [pks]);
    const n = Number((rows as any)[0].n);
    log(`[VERIFY] ${c.name} = ${n} ${n === 0 ? "OK" : "MISMATCH"}`);
    if (n !== 0) ok = false;
  }

  const [rows] = await pool.query(`SELECT game_pk, away_score, home_score FROM mlb_games WHERE game_pk IN (?)`, [
    pks,
  ]);
  const dbByPk = new Map((rows as any[]).map((r) => [Number(r.game_pk), r]));
  let scoreMismatches = 0;
  for (const pk of pks) {
    const dbRow = dbByPk.get(pk);
    if (!dbRow) {
      log(`[VERIFY] score check FAIL — game_pk=${pk} missing from mlb_games after load`);
      scoreMismatches++;
      continue;
    }
    const dataset = datasetByPk.get(pk);
    if (!dataset) continue; // shouldn't happen — pk came from this dataset — but never fail on it
    if (Number(dbRow.away_score) !== dataset.awayScore || Number(dbRow.home_score) !== dataset.homeScore) {
      log(
        `[VERIFY] score mismatch game_pk=${pk} db=${dbRow.away_score}-${dbRow.home_score} dataset=${dataset.awayScore}-${dataset.homeScore}`,
      );
      scoreMismatches++;
    }
  }
  log(`[VERIFY] score cross-foot: ${pks.length - scoreMismatches}/${pks.length} OK`);
  if (scoreMismatches > 0) ok = false;

  return ok;
}

async function main(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error(`${TAG} DATABASE_URL is not set — aborting.`);
    process.exit(1);
  }

  log(`starting nightly canonical refresh for season ${SEASON}`);

  const pool = mysql.createPool({
    uri: dbUrl,
    connectionLimit: 4,
    waitForConnections: true,
    queueLimit: 50,
    connectTimeout: 15000,
    idleTimeout: 30000,
  });

  let exitCode = 0;
  try {
    // (a) refresh games-2026.json from statsapi
    run("build_games_dataset", "python3", [
      join(CRAWL_DIR, "build_games_dataset.py"),
      "--start",
      String(SEASON),
      "--end",
      String(SEASON),
    ]);

    // (b) read the refreshed finals
    const finals = loadDatasetFinals();
    log(`dataset finals for season ${SEASON}: ${finals.length}`);

    // (c) diff against the DB
    const dbPks = await loadDbGamePks(pool);
    const missing = computeMissingGames(finals, dbPks);

    if (missing.length === 0) {
      log(`up to date — mlb_games already has all ${finals.length} finals for season ${SEASON}`);
    } else {
      log(`missing ${missing.length} final(s): ${missing.map((g) => g.gamePk).join(", ")}`);

      // (d) crawl only the missing feeds
      const shardPath = writeDeltaShard(missing);
      try {
        run("crawl_feeds (delta shard)", "python3", [join(CRAWL_DIR, "crawl_feeds.py"), "--shard", shardPath]);
      } finally {
        if (existsSync(shardPath)) unlinkSync(shardPath);
      }

      // (e) transform feeds -> NDJSON
      run("transform", "python3", [join(ETL_DIR, "transform.py"), "--season", String(SEASON)]);

      // (f) load --delta
      run("load (delta)", "npx", ["tsx", join(ETL_DIR, "load.mts"), "--season", String(SEASON), "--delta"]);

      // (g) inline delta verification
      const datasetByPk = new Map(finals.map((g) => [g.gamePk, g]));
      const pks = missing.map((g) => g.gamePk);
      const verified = await deltaVerify(pool, pks, datasetByPk);
      if (!verified) {
        throw new Error("delta verification failed — see [VERIFY] lines above");
      }

      log(`delta refresh complete — loaded and verified ${missing.length} game(s)`);
    }
  } catch (err: any) {
    console.error(`${TAG} FATAL:`, err?.message ?? err);
    exitCode = 1;
  } finally {
    await pool.end();
  }

  if (exitCode !== 0) process.exit(exitCode);
}

// Only run the live orchestration when this file is executed directly (`npx tsx
// refresh_canonical.mts`), never as a side effect of another module importing
// `computeMissingGames` (e.g. refresh_canonical.test.ts) — importing this file must never spawn
// python subprocesses, hit statsapi, or touch DATABASE_URL.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(`${TAG} FATAL:`, err?.message ?? err);
    process.exit(1);
  });
}
