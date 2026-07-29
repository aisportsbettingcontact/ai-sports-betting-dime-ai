/**
 * Batch-load the MLB canonical NDJSON corpus (docs/mlb-stats-api/data/etl-out/) into the
 * production `mlb_*` tables (raw mysql2/promise — schema already deployed via db-push.yml).
 *
 * Idempotent: every insert is `INSERT ... ON DUPLICATE KEY UPDATE`, keyed on the natural PK of
 * each table, so re-running any season/table is always safe.
 *
 * Usage (DATABASE_URL is not in any local .env — must come from Railway):
 *   railway run --service ai-sports-betting-dime-ai -- npx tsx scripts/mlb-etl/load.mts --season 2026
 *   railway run --service ai-sports-betting-dime-ai -- npx tsx scripts/mlb-etl/load.mts --all
 *   railway run --service ai-sports-betting-dime-ai -- npx tsx scripts/mlb-etl/load.mts --season 2026 --table mlb_games
 *   railway run --service ai-sports-betting-dime-ai -- npx tsx scripts/mlb-etl/load.mts --season 2026 --delta
 *
 * Dependency order: mlb_seasons, mlb_franchises, mlb_venues, mlb_people (dims — loaded once,
 * before the first season) then per season: mlb_games, mlb_plays, mlb_pitches,
 * mlb_boxscore_batting, mlb_boxscore_pitching, mlb_officials.
 *
 * --delta: for the nightly canonical refresh, where etl-out/{season}/*.ndjson on the runner only
 * ever holds the newly-crawled missing games rather than the whole season. Swaps the post-load
 * sanity check from season-wide equality against manifest.json to (1) mlb_games checked with
 * `>=` season-wide plus an explicit "every gamePk loaded this run now exists" check, and (2)
 * every other table checked for exact equality but scoped to `game_pk IN (<gamePks loaded into
 * mlb_games this run>)`. Default (non-delta) behavior is unchanged.
 *
 * NEVER print, log, or persist DATABASE_URL.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const TAG = "[MlbLoad]";
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const DATA_DIR = join(REPO, "docs", "mlb-stats-api", "data");
const ETL_OUT = join(DATA_DIR, "etl-out");
const DIMS_DIR = join(ETL_OUT, "dims");
const LOAD_LOG = join(ETL_OUT, "load-log.jsonl");

const BATCH_SIZE_DEFAULT = 1000;
const MIN_BATCH_SIZE = 50;
const PROGRESS_EVERY = 25_000;
const RETRY_BACKOFFS_MS = [2000, 4000, 8000];

type ColSpec = { name: string; boolean?: boolean; json?: boolean };
type TableSpec = { name: string; columns: ColSpec[]; pk: string[] };

const col = (name: string): ColSpec => ({ name });
const boolCol = (name: string): ColSpec => ({ name, boolean: true });
const jsonCol = (name: string): ColSpec => ({ name, json: true });

// ─── table specs (column order mirrors drizzle/mlb.schema.ts; NDJSON keys == column names) ──

const DIM_TABLES: TableSpec[] = [
  {
    name: "mlb_seasons",
    pk: ["season"],
    columns: [
      col("season"),
      col("regular_season_start"),
      col("regular_season_end"),
      col("postseason_end"),
      col("games_expected"),
      col("notes"),
    ],
  },
  {
    name: "mlb_franchises",
    pk: ["team_id"],
    columns: [
      col("team_id"),
      col("name"),
      col("abbrev"),
      col("league"),
      col("division"),
      boolCol("active"),
      col("first_season"),
      col("last_season"),
      col("vsin_slug"),
      col("an_slug"),
      col("an_team_id"),
      col("br_abbrev"),
      col("mlb_code"),
      col("an_logo_slug"),
      col("db_slug"),
    ],
  },
  {
    name: "mlb_venues",
    pk: ["venue_id"],
    columns: [
      col("venue_id"),
      col("name"),
      boolCol("active"),
      col("capacity"),
      col("turf_type"),
      col("roof_type"),
      col("left_line"),
      col("left_field"),
      col("left_center"),
      col("center"),
      col("right_center"),
      col("right_field"),
      col("right_line"),
      col("city"),
      col("state"),
      col("timezone"),
    ],
  },
  {
    name: "mlb_people",
    pk: ["mlbam_id"],
    columns: [
      col("mlbam_id"),
      col("full_name"),
      col("first_name"),
      col("last_name"),
      col("primary_position"),
      col("bat_side"),
      col("pitch_hand"),
      col("birth_date"),
      col("mlb_debut"),
      boolCol("active"),
      boolCol("is_umpire"),
      col("br_id"),
      col("an_player_id"),
      col("rotowire_id"),
      col("retrosheet_id"),
    ],
  },
];

const SEASON_TABLES: TableSpec[] = [
  {
    name: "mlb_games",
    pk: ["game_pk"],
    columns: [
      col("game_pk"),
      col("game_guid"),
      col("season"),
      col("game_type"),
      col("series_description"),
      col("official_date"),
      col("game_datetime_utc"),
      col("day_night"),
      col("double_header"),
      col("game_number"),
      col("games_in_series"),
      col("series_game_number"),
      col("status_code"),
      col("detailed_state"),
      boolCol("is_tie"),
      col("away_team_id"),
      col("home_team_id"),
      col("away_score"),
      col("home_score"),
      col("away_hits"),
      col("home_hits"),
      col("away_errors"),
      col("home_errors"),
      col("innings"),
      col("scheduled_innings"),
      col("venue_id"),
      col("attendance"),
      col("duration_minutes"),
      col("first_pitch_utc"),
      col("weather_condition"),
      col("temp_f"),
      col("wind"),
      col("winner_pitcher_id"),
      col("loser_pitcher_id"),
      col("save_pitcher_id"),
      col("gameday_type"),
      col("feed_timestamp"),
      col("loaded_at"),
    ],
  },
  {
    name: "mlb_plays",
    pk: ["game_pk", "at_bat_index"],
    columns: [
      col("game_pk"),
      col("at_bat_index"),
      col("inning"),
      col("half"),
      col("batter_id"),
      col("pitcher_id"),
      col("bat_side"),
      col("pitch_hand"),
      col("event_type"),
      col("event"),
      col("description"),
      col("rbi"),
      col("away_score"),
      col("home_score"),
      boolCol("is_scoring_play"),
      boolCol("has_out"),
      col("outs_end"),
      col("balls_end"),
      col("strikes_end"),
      col("men_on_base_split"),
      col("start_time_utc"),
      col("end_time_utc"),
      jsonCol("runners"),
      col("pitch_count"),
    ],
  },
  {
    name: "mlb_pitches",
    pk: ["play_id"],
    columns: [
      col("play_id"),
      col("game_pk"),
      col("season"),
      col("at_bat_index"),
      col("pitch_number"),
      col("batter_id"),
      col("pitcher_id"),
      boolCol("is_pitch"),
      col("call_code"),
      col("call_description"),
      col("pitch_type_code"),
      col("pitch_type"),
      col("type_confidence"),
      col("balls"),
      col("strikes"),
      col("start_speed"),
      col("end_speed"),
      col("spin_rate"),
      col("extension"),
      col("plate_time"),
      col("px"),
      col("pz"),
      col("zone"),
      col("sz_top"),
      col("sz_bot"),
      col("break_angle"),
      col("break_length"),
      col("break_vertical"),
      col("break_horizontal"),
      boolCol("is_in_play"),
      col("launch_speed"),
      col("launch_angle"),
      col("total_distance"),
      col("trajectory"),
      col("hit_coord_x"),
      col("hit_coord_y"),
    ],
  },
  {
    name: "mlb_boxscore_batting",
    pk: ["game_pk", "mlbam_id"],
    columns: [
      col("game_pk"),
      col("mlbam_id"),
      col("team_id"),
      col("batting_order"),
      col("position"),
      col("ab"),
      col("r"),
      col("h"),
      col("doubles"),
      col("triples"),
      col("hr"),
      col("rbi"),
      col("bb"),
      col("so"),
      col("hbp"),
      col("sb"),
      col("cs"),
      col("lob"),
      col("sac_bunts"),
      col("sac_flies"),
    ],
  },
  {
    name: "mlb_boxscore_pitching",
    pk: ["game_pk", "mlbam_id"],
    columns: [
      col("game_pk"),
      col("mlbam_id"),
      col("team_id"),
      col("outs_recorded"),
      col("batters_faced"),
      col("h"),
      col("r"),
      col("er"),
      col("bb"),
      col("so"),
      col("hr"),
      col("pitches"),
      col("strikes"),
      boolCol("win"),
      boolCol("loss"),
      boolCol("save"),
      boolCol("hold"),
    ],
  },
  {
    name: "mlb_officials",
    pk: ["game_pk", "mlbam_id"],
    columns: [col("game_pk"), col("mlbam_id"), col("position")],
  },
];

// ─── helpers ──────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toRow(spec: TableSpec, obj: Record<string, unknown>): unknown[] {
  return spec.columns.map((c) => {
    let v = obj[c.name];
    if (v === undefined) v = null;
    if (v === null) return null;
    if (c.boolean) return v === true ? 1 : v === false ? 0 : v;
    if (c.json) return JSON.stringify(v);
    return v;
  });
}

function appendLoadLog(entry: Record<string, unknown>): void {
  mkdirSync(dirname(LOAD_LOG), { recursive: true });
  appendFileSync(LOAD_LOG, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
}

function discoverSeasons(): number[] {
  if (!existsSync(ETL_OUT)) return [];
  return readdirSync(ETL_OUT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{4}$/.test(d.name))
    .map((d) => parseInt(d.name, 10))
    .sort((a, b) => a - b);
}

/** Upsert a batch of rows; halves the batch (recursively) on ER_NET_PACKET_TOO_LARGE, and
 * retries transient failures up to 3x with 2s/4s/8s backoff. Mutates `state.batchSize` down
 * permanently for the caller once a packet-too-large error is seen, so later chunks read from
 * the stream are pre-sized smaller. Returns total rows affected (insert=1, update=2 per MySQL
 * semantics — used only for reporting, not for correctness checks). */
async function upsertBatch(
  pool: mysql.Pool,
  spec: TableSpec,
  rows: unknown[][],
  state: { batchSize: number },
): Promise<number> {
  if (rows.length === 0) return 0;

  const nonPkCols = spec.columns.filter((c) => !spec.pk.includes(c.name));
  const colNames = spec.columns.map((c) => c.name).join(", ");
  const placeholders = rows.map(() => `(${spec.columns.map(() => "?").join(",")})`).join(",");
  const updateClause = nonPkCols.map((c) => `${c.name}=VALUES(${c.name})`).join(", ");
  const sql = `INSERT INTO ${spec.name} (${colNames}) VALUES ${placeholders} ON DUPLICATE KEY UPDATE ${updateClause}`;
  const flat = rows.flat();

  for (let attempt = 0; attempt <= RETRY_BACKOFFS_MS.length; attempt++) {
    try {
      const [result] = await pool.query(sql, flat);
      return (result as mysql.ResultSetHeader).affectedRows ?? 0;
    } catch (err: any) {
      if (err?.code === "ER_NET_PACKET_TOO_LARGE" && rows.length > 1) {
        state.batchSize = Math.max(MIN_BATCH_SIZE, Math.floor(state.batchSize / 2));
        console.warn(
          `${TAG} ER_NET_PACKET_TOO_LARGE on ${spec.name} (${rows.length} rows) — halving batch size to ${state.batchSize} and retrying`,
        );
        const mid = Math.ceil(rows.length / 2);
        const a = await upsertBatch(pool, spec, rows.slice(0, mid), state);
        const b = await upsertBatch(pool, spec, rows.slice(mid), state);
        return a + b;
      }
      if (attempt === RETRY_BACKOFFS_MS.length) throw err;
      const backoff = RETRY_BACKOFFS_MS[attempt];
      console.error(
        `${TAG} batch upsert failed for ${spec.name} (attempt ${attempt + 1}/${RETRY_BACKOFFS_MS.length + 1}): ${err?.code ?? err?.message ?? err} — retrying in ${backoff}ms`,
      );
      await sleep(backoff);
    }
  }
  /* unreachable */
  return 0;
}

async function loadTable(
  pool: mysql.Pool,
  spec: TableSpec,
  filePath: string,
  season: number | null,
  collectGamePks?: number[],
): Promise<boolean> {
  const label = season !== null ? `season=${season}` : "dims";
  if (!existsSync(filePath)) {
    console.log(`${TAG} skip ${spec.name} (${label}) — file not found: ${filePath}`);
    return false;
  }

  console.log(`${TAG}[START] ${spec.name} ${label}`);
  const start = Date.now();
  const state = { batchSize: BATCH_SIZE_DEFAULT };
  let buffer: unknown[][] = [];
  let rowsRead = 0;
  let rowsAffected = 0;
  let lastProgressAt = 0;

  const rl = createInterface({ input: createReadStream(filePath, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const obj = JSON.parse(trimmed);
    buffer.push(toRow(spec, obj));
    if (collectGamePks && typeof obj.game_pk === "number") collectGamePks.push(obj.game_pk);
    rowsRead++;

    if (buffer.length >= state.batchSize) {
      rowsAffected += await upsertBatch(pool, spec, buffer, state);
      buffer = [];
    }
    if (rowsRead - lastProgressAt >= PROGRESS_EVERY) {
      console.log(`${TAG}[PROGRESS] ${spec.name} ${label} rows_read=${rowsRead}`);
      lastProgressAt = rowsRead;
    }
  }
  if (buffer.length > 0) {
    rowsAffected += await upsertBatch(pool, spec, buffer, state);
  }

  const ms = Date.now() - start;
  console.log(`${TAG}[DONE] ${spec.name} ${label} rows_read=${rowsRead} rows_affected=${rowsAffected} ms=${ms}`);
  appendLoadLog({ season: season ?? "dims", table: spec.name, rows_read: rowsRead, rows_affected: rowsAffected, ms });
  return true;
}

interface SanityCheckDef {
  table: string;
  manifestKey: string;
  sql: string;
  /** Delta-mode equivalent: scoped to `game_pk IN (?)` instead of `season = ?`. */
  deltaSql: string;
}

const SANITY_CHECKS: SanityCheckDef[] = [
  {
    table: "mlb_games",
    manifestKey: "games",
    sql: `SELECT COUNT(*) n FROM mlb_games WHERE season = ?`,
    deltaSql: `SELECT COUNT(*) n FROM mlb_games WHERE game_pk IN (?)`,
  },
  {
    table: "mlb_pitches",
    manifestKey: "pitches",
    sql: `SELECT COUNT(*) n FROM mlb_pitches WHERE season = ?`,
    deltaSql: `SELECT COUNT(*) n FROM mlb_pitches WHERE game_pk IN (?)`,
  },
  {
    table: "mlb_plays",
    manifestKey: "plays",
    sql: `SELECT COUNT(*) n FROM mlb_plays p JOIN mlb_games g ON g.game_pk = p.game_pk WHERE g.season = ?`,
    deltaSql: `SELECT COUNT(*) n FROM mlb_plays WHERE game_pk IN (?)`,
  },
  {
    table: "mlb_boxscore_batting",
    manifestKey: "batting_rows",
    sql: `SELECT COUNT(*) n FROM mlb_boxscore_batting b JOIN mlb_games g ON g.game_pk = b.game_pk WHERE g.season = ?`,
    deltaSql: `SELECT COUNT(*) n FROM mlb_boxscore_batting WHERE game_pk IN (?)`,
  },
  {
    table: "mlb_boxscore_pitching",
    manifestKey: "pitching_rows",
    sql: `SELECT COUNT(*) n FROM mlb_boxscore_pitching b JOIN mlb_games g ON g.game_pk = b.game_pk WHERE g.season = ?`,
    deltaSql: `SELECT COUNT(*) n FROM mlb_boxscore_pitching WHERE game_pk IN (?)`,
  },
  {
    table: "mlb_officials",
    manifestKey: "officials",
    sql: `SELECT COUNT(*) n FROM mlb_officials o JOIN mlb_games g ON g.game_pk = o.game_pk WHERE g.season = ?`,
    deltaSql: `SELECT COUNT(*) n FROM mlb_officials WHERE game_pk IN (?)`,
  },
];

/** Reconciles the tables loaded *this run* for `season` against the season's manifest.json.
 * Only checks tables actually touched this invocation (respects --table). Aborts the process
 * (nonzero exit) on any mismatch. */
async function sanityCheckSeason(pool: mysql.Pool, season: number, loadedTables: Set<string>): Promise<void> {
  const manifestPath = join(ETL_OUT, String(season), "manifest.json");
  if (!existsSync(manifestPath)) {
    console.warn(`${TAG}[SANITY] season=${season} — no manifest.json found, skipping sanity check`);
    return;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

  let allOk = true;
  for (const check of SANITY_CHECKS) {
    if (!loadedTables.has(check.table)) continue;
    const expected = manifest[check.manifestKey];
    const [rows] = await pool.query(check.sql, [season]);
    const actual = Number((rows as any)[0].n);
    const ok = actual === expected;
    console.log(
      `${TAG}[SANITY] season=${season} table=${check.table} expected=${expected} actual=${actual} ${ok ? "OK" : "MISMATCH"}`,
    );
    if (!ok) allOk = false;
  }
  if (!allOk) {
    console.error(`${TAG} sanity check FAILED for season ${season} — aborting.`);
    process.exit(1);
  }
}

/** Delta-mode reconciliation. Unlike `sanityCheckSeason` (equality against a manifest that is
 * assumed to represent the *whole* season), delta runs only ever transform whatever is on disk
 * in feeds-{season}/ this invocation — on a nightly refresh runner that's just the newly-crawled
 * missing games, so `manifest.json` reflects only this run's rows. Two different comparisons
 * follow from that:
 *   - mlb_games is season-scoped (`WHERE season = ?`) and already holds every prior load, so it
 *     can only ever be checked with `>=` against this run's manifest count, plus an explicit
 *     "every gamePk we just loaded now exists" check.
 *   - every other table is checked with an exact match, but scoped to `game_pk IN (<gamePks
 *     loaded into mlb_games this run>)` rather than the whole season — that scoped count is
 *     always exactly the manifest count, however small or large the delta was.
 * `loadedGamePks` comes from `loadTable`'s optional collector on the mlb_games file for this
 * invocation; if mlb_games wasn't loaded this run (e.g. a `--table` retry of another table) there
 * is nothing to scope the delta checks to, so they are skipped with a warning rather than failed. */
async function deltaSanityCheckSeason(
  pool: mysql.Pool,
  season: number,
  loadedTables: Set<string>,
  loadedGamePks: number[],
): Promise<void> {
  const manifestPath = join(ETL_OUT, String(season), "manifest.json");
  if (!existsSync(manifestPath)) {
    console.warn(`${TAG}[DELTA-SANITY] season=${season} — no manifest.json found, skipping delta sanity check`);
    return;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

  if (loadedGamePks.length === 0) {
    console.warn(
      `${TAG}[DELTA-SANITY] season=${season} — mlb_games was not loaded this run, no gamePks to scope delta checks to; skipping`,
    );
    return;
  }

  let allOk = true;

  if (loadedTables.has("mlb_games")) {
    const expected = manifest.games;
    const [rows] = await pool.query(`SELECT COUNT(*) n FROM mlb_games WHERE season = ?`, [season]);
    const actual = Number((rows as any)[0].n);
    const ok = actual >= expected;
    console.log(
      `${TAG}[DELTA-SANITY] season=${season} table=mlb_games mode=season>=manifest expected>=${expected} actual=${actual} ${ok ? "OK" : "MISMATCH"}`,
    );
    if (!ok) allOk = false;

    const [existsRows] = await pool.query(`SELECT COUNT(*) n FROM mlb_games WHERE game_pk IN (?)`, [loadedGamePks]);
    const existsCount = Number((existsRows as any)[0].n);
    const existsOk = existsCount === loadedGamePks.length;
    console.log(
      `${TAG}[DELTA-SANITY] season=${season} check=all_delta_gamepks_present expected=${loadedGamePks.length} actual=${existsCount} ${existsOk ? "OK" : "MISMATCH"}`,
    );
    if (!existsOk) allOk = false;
  }

  for (const check of SANITY_CHECKS) {
    if (check.table === "mlb_games") continue;
    if (!loadedTables.has(check.table)) continue;
    const expected = manifest[check.manifestKey];
    const [rows] = await pool.query(check.deltaSql, [loadedGamePks]);
    const actual = Number((rows as any)[0].n);
    const ok = actual === expected;
    console.log(
      `${TAG}[DELTA-SANITY] season=${season} table=${check.table} scope=delta_gamepks expected=${expected} actual=${actual} ${ok ? "OK" : "MISMATCH"}`,
    );
    if (!ok) allOk = false;
  }

  if (!allOk) {
    console.error(`${TAG} delta sanity check FAILED for season ${season} — aborting.`);
    process.exit(1);
  }
}

function parseArgs(argv: string[]): { seasons: number[]; tableFilter: string | null; delta: boolean } {
  const all = argv.includes("--all");
  const seasonIdx = argv.indexOf("--season");
  const season = seasonIdx >= 0 ? parseInt(argv[seasonIdx + 1], 10) : null;
  const tableIdx = argv.indexOf("--table");
  const tableFilter = tableIdx >= 0 ? argv[tableIdx + 1] : null;
  const delta = argv.includes("--delta");

  if (!all && season === null) {
    console.error(`${TAG} usage: load.mts (--season YYYY | --all) [--table TABLE_NAME] [--delta]`);
    process.exit(1);
  }
  if (tableFilter) {
    const known = [...DIM_TABLES, ...SEASON_TABLES].map((t) => t.name);
    if (!known.includes(tableFilter)) {
      console.error(`${TAG} unknown --table ${tableFilter}; known: ${known.join(", ")}`);
      process.exit(1);
    }
  }

  const seasons = all ? discoverSeasons() : [season as number];
  if (seasons.length === 0) {
    console.error(`${TAG} no seasons found under ${ETL_OUT}`);
    process.exit(1);
  }
  return { seasons, tableFilter, delta };
}

async function main(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error(`${TAG} DATABASE_URL is not set — aborting.`);
    process.exit(1);
  }

  const { seasons, tableFilter, delta } = parseArgs(process.argv.slice(2));
  console.log(`${TAG} seasons=${seasons.join(",")} table=${tableFilter ?? "(all)"} delta=${delta}`);

  const pool = mysql.createPool({
    uri: dbUrl,
    connectionLimit: 4,
    waitForConnections: true,
    queueLimit: 50,
    connectTimeout: 15000,
    idleTimeout: 30000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    compress: true,
  });

  try {
    let dimsDone = false;
    for (const season of seasons) {
      if (!dimsDone) {
        for (const t of DIM_TABLES) {
          if (tableFilter && t.name !== tableFilter) continue;
          await loadTable(pool, t, join(DIMS_DIR, `${t.name}.ndjson`), null);
        }
        dimsDone = true;
      }

      const loadedTables = new Set<string>();
      const loadedGamePks: number[] = [];
      for (const t of SEASON_TABLES) {
        if (tableFilter && t.name !== tableFilter) continue;
        const file = join(ETL_OUT, String(season), `${t.name}.ndjson`);
        const collect = delta && t.name === "mlb_games" ? loadedGamePks : undefined;
        const loaded = await loadTable(pool, t, file, season, collect);
        if (loaded) loadedTables.add(t.name);
      }

      if (loadedTables.size > 0) {
        if (delta) {
          await deltaSanityCheckSeason(pool, season, loadedTables, loadedGamePks);
        } else {
          await sanityCheckSeason(pool, season, loadedTables);
        }
      }
    }
    console.log(`${TAG} complete.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`${TAG} FATAL:`, err?.message ?? err);
  process.exit(1);
});
