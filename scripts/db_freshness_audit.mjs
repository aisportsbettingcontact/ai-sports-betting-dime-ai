/**
 * db_freshness_audit.mjs — freshness dashboard for EVERY table in the database.
 *
 * For each table in the current schema, reports:
 *   total       — COUNT(*)
 *   new_today   — rows whose insert-time column falls on today (UTC)
 *   last_insert — MAX(insert-time column), normalized to 'YYYY-MM-DD HH:MM:SS' UTC
 *   age         — hours/days since last insert
 *   status      — LIVE (<24h) / RECENT (<72h) / STALE (<30d) / DEAD (>=30d) / STATIC (no ts col)
 *
 * Handles the schema quirks in this repo:
 *   - MLB tables use DATETIME/TIMESTAMP columns (created_at, createdAt, scraped_at, ...)
 *   - wc2026_espn_* tables store scraped_at/created_at as BIGINT epoch-ms
 *     (drizzle/wc2026.schema.ts) — converted via FROM_UNIXTIME(col/1000) so
 *     new_today and last_insert agree, unlike the raw dashboard output.
 *
 * Usage: node scripts/db_freshness_audit.mjs [--json] [--min-rows N]
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const asJson = process.argv.includes('--json');
const minRowsArg = process.argv.indexOf('--min-rows');
const minRows = minRowsArg !== -1 ? Number(process.argv[minRowsArg + 1]) : 0;

// Insert-time column candidates, highest priority first. Covers both the
// snake_case and camelCase conventions used across drizzle/schema.ts and
// drizzle/wc2026.schema.ts.
const TS_CANDIDATES = [
  'last_inserted_at', 'lastInsertedAt',
  'inserted_at', 'insertedAt',
  'ingested_at', 'ingestedAt',
  'scraped_at', 'scrapedAt',
  'created_at', 'createdAt',
  'snapshot_ts', 'snapshotTs',
  'modeled_at', 'modeledAt',
  'frozen_at', 'frozenAt',
  'updated_at', 'updatedAt',
  'validated_at', 'validatedAt',
  'timestamp', 'ts',
];

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Add it to .env or the environment.');
    process.exit(1);
  }
  const pool = mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 5 });

  // All tables + their columns in one pass over information_schema.
  const [cols] = await pool.execute(`
    SELECT TABLE_NAME AS tbl, COLUMN_NAME AS col, DATA_TYPE AS dtype
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
    ORDER BY TABLE_NAME
  `);

  /** @type {Map<string, Array<{col: string, dtype: string}>>} */
  const tables = new Map();
  for (const { tbl, col, dtype } of cols) {
    if (!tables.has(tbl)) tables.set(tbl, []);
    tables.get(tbl).push({ col, dtype });
  }

  const rows = [];
  for (const [tbl, columns] of tables) {
    // Pick the best insert-time column by candidate priority.
    let tsCol = null;
    let tsType = null;
    for (const cand of TS_CANDIDATES) {
      const hit = columns.find((c) => c.col === cand);
      if (hit) { tsCol = hit.col; tsType = hit.dtype; break; }
    }

    let sql;
    if (!tsCol) {
      sql = `SELECT COUNT(*) AS total, NULL AS new_today, NULL AS last_insert FROM \`${tbl}\``;
    } else if (tsType === 'bigint' || tsType === 'int') {
      // Epoch-ms columns (wc2026_espn_*). Values are UTC ms since 1970.
      const expr = `FROM_UNIXTIME(\`${tsCol}\` / 1000)`;
      sql = `
        SELECT COUNT(*) AS total,
               SUM(DATE(${expr}) = UTC_DATE()) AS new_today,
               DATE_FORMAT(MAX(${expr}), '%Y-%m-%d %H:%i:%s') AS last_insert
        FROM \`${tbl}\``;
    } else {
      sql = `
        SELECT COUNT(*) AS total,
               SUM(DATE(\`${tsCol}\`) = UTC_DATE()) AS new_today,
               DATE_FORMAT(MAX(\`${tsCol}\`), '%Y-%m-%d %H:%i:%s') AS last_insert
        FROM \`${tbl}\``;
    }

    try {
      const [[r]] = await pool.execute(sql);
      rows.push({
        table: tbl,
        ts_col: tsCol,
        total: Number(r.total),
        new_today: r.new_today === null ? null : Number(r.new_today),
        last_insert: r.last_insert ?? null,
      });
    } catch (err) {
      rows.push({ table: tbl, ts_col: tsCol, total: -1, new_today: null, last_insert: null, error: err.message });
    }
  }

  await pool.end();

  // Staleness classification against UTC now.
  const now = Date.now();
  for (const r of rows) {
    if (r.error) { r.status = 'ERROR'; r.age = ''; continue; }
    if (!r.last_insert) { r.status = 'STATIC'; r.age = ''; continue; }
    const ageMs = now - Date.parse(r.last_insert + 'Z');
    const ageH = ageMs / 3_600_000;
    r.age = ageH < 48 ? `${ageH.toFixed(1)}h` : `${(ageH / 24).toFixed(1)}d`;
    r.status = ageH < 24 ? 'LIVE' : ageH < 72 ? 'RECENT' : ageH < 720 ? 'STALE' : 'DEAD';
  }

  const filtered = rows.filter((r) => r.total >= minRows || r.total === -1);
  // Freshest first; timestamp-less tables sink to the bottom.
  filtered.sort((a, b) => (b.last_insert ?? '').localeCompare(a.last_insert ?? ''));

  if (asJson) {
    console.log(JSON.stringify(filtered, null, 2));
    return;
  }

  const pad = (s, n) => String(s ?? '').padEnd(n);
  const header = pad('table', 34) + pad('total', 9) + pad('new_today', 11) + pad('last_insert (UTC)', 21) + pad('age', 8) + pad('status', 8) + 'ts_col';
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const r of filtered) {
    console.log(
      pad(r.table, 34) +
      pad(r.total === -1 ? 'ERR' : r.total, 9) +
      pad(r.new_today ?? '—', 11) +
      pad(r.last_insert ?? '—', 21) +
      pad(r.age, 8) +
      pad(r.status, 8) +
      (r.ts_col ?? '—') +
      (r.error ? `  ! ${r.error}` : '')
    );
  }

  const flagged = filtered.filter((r) => (r.status === 'STALE' || r.status === 'DEAD') && r.total > 0);
  if (flagged.length) {
    console.log('\n[FLAGGED] Tables with data but no recent writes:');
    for (const r of flagged) console.log(`  - ${r.table}: last insert ${r.last_insert} (${r.age} ago)`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
