#!/usr/bin/env node
/**
 * Replays the immutable Drizzle migration history while bridging the verified
 * wc2026_matches naming collision on empty databases.
 *
 * Historical facts:
 * - 0097 creates the canonical domain table as wc2026_matches.
 * - 0104 creates an unrelated ESPN scraper table under the same name.
 * - 0107 creates the final wc2026_espn_* tables and drops the temporary ESPN
 *   source tables.
 *
 * Production already has the intended final table shapes and a journal newer
 * than these migrations. Existing databases therefore never execute either
 * bridge. A fresh database temporarily parks the canonical table before 0104
 * and restores it immediately after 0107.
 *
 * Safety:
 * - MODE=plan is the default and performs no writes.
 * - MODE=apply requires CONFIRM=RECONCILE.
 * - Historical SQL files and existing journal rows are never modified.
 * - Bridge operations validate exact table identity and fail closed.
 * - TARGET_TAG may stop at a named migration for staged verification.
 */
import { readFileSync } from "node:fs";
import { readMigrationFiles } from "drizzle-orm/migrator";
import mysql from "mysql2/promise";

const MODE = (process.env.MODE || "plan").trim();
const CONFIRM = (process.env.CONFIRM || "").trim();
const TARGET_TAG = (process.env.TARGET_TAG || "").trim();
const DATABASE_URL = process.env.DATABASE_URL;

const PRESERVE_BEFORE_TAG = "0104_outgoing_night_thrasher";
const RESTORE_AFTER_TAG = "0107_majestic_kinsey_walden";
const ADOPT_BEFORE_TAG = "0109_concerned_exiles";
const CANONICAL_TABLE = "wc2026_matches";
const PARKED_CANONICAL_TABLE = "wc2026_matches_canonical_bridge";
const ADOPTED_0108_TABLES = [
  "wc2026MatchOdds",
  "wc2026_data_lineage",
  "wc2026_holdout_validation",
  "wc2026_market_edges",
  "wc2026_market_no_vig",
  "wc2026_model_grades",
  "wc2026_model_runs",
  "wc2026_provider_match_map",
  "wc2026_recommendations",
];

if (!DATABASE_URL) {
  console.error("::error::DATABASE_URL is not set");
  process.exit(1);
}
if (!["plan", "apply"].includes(MODE)) {
  console.error("::error::MODE must be plan or apply");
  process.exit(1);
}
if (MODE === "apply" && CONFIRM !== "RECONCILE") {
  console.error("::error::MODE=apply requires CONFIRM=RECONCILE");
  process.exit(1);
}

const journal = JSON.parse(
  readFileSync("./drizzle/meta/_journal.json", "utf8")
);
const legacyJournal = JSON.parse(
  readFileSync("./drizzle/meta/production_legacy_journal.json", "utf8")
);
const snapshot0108 = JSON.parse(
  readFileSync("./drizzle/meta/0108_snapshot.json", "utf8")
);
const migrations = readMigrationFiles({ migrationsFolder: "./drizzle" });
const tagByWhen = new Map(
  journal.entries.map(entry => [Number(entry.when), entry.tag])
);
const migrationByWhen = new Map(
  migrations.map(migration => [Number(migration.folderMillis), migration])
);
const migrationByTag = new Map(
  migrations.map(migration => [
    tagByWhen.get(Number(migration.folderMillis)),
    migration,
  ])
);
const legacyJournalRows = new Set(
  legacyJournal.rows.map(row => `${Number(row.createdAt)}:${String(row.hash)}`)
);

if (migrations.length !== journal.entries.length) {
  console.error(
    `::error::Migration file count (${migrations.length}) does not match journal entries (${journal.entries.length})`
  );
  process.exit(1);
}

let targetIndex = migrations.length - 1;
if (TARGET_TAG) {
  const target = migrationByTag.get(TARGET_TAG);
  if (!target) {
    console.error(`::error::Unknown TARGET_TAG=${TARGET_TAG}`);
    process.exit(1);
  }
  targetIndex = migrations.indexOf(target);
}
const selectedMigrations = migrations.slice(0, targetIndex + 1);
const selectedTarget = selectedMigrations[selectedMigrations.length - 1];
const targetWhen = Number(selectedTarget.folderMillis);
const targetTag = tagByWhen.get(targetWhen);

async function tableColumns(conn, tableName) {
  const [rows] = await conn.query(
    `SELECT column_name AS columnName
       FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ?
      ORDER BY ordinal_position`,
    [tableName]
  );
  return rows.map(row => row.columnName);
}

function isCanonicalShape(columns) {
  return columns.includes("match_id") && !columns.includes("matchId");
}

function isEspnShape(columns) {
  return columns.includes("matchId") && !columns.includes("match_id");
}

function quoteIdentifier(identifier) {
  if (!/^[A-Za-z0-9_]+$/.test(identifier)) {
    throw new Error(
      `unsafe SQL identifier in migration snapshot: ${identifier}`
    );
  }
  return `\`${identifier}\``;
}

function indexColumnName(column) {
  if (typeof column === "string") {
    return column;
  }
  if (column && typeof column.expression === "string" && !column.isExpression) {
    return column.expression;
  }
  throw new Error("unsupported expression index in 0108 adoption snapshot");
}

function createTableSqlFromSnapshot(table) {
  const definitions = [];
  for (const column of Object.values(table.columns)) {
    let definition = `${quoteIdentifier(column.name)} ${column.type}`;
    if (column.autoincrement) definition += " AUTO_INCREMENT";
    if (column.notNull) definition += " NOT NULL";
    if (column.default !== undefined)
      definition += ` DEFAULT ${String(column.default)}`;
    definitions.push(definition);
  }
  for (const primaryKey of Object.values(table.compositePrimaryKeys || {})) {
    definitions.push(
      `CONSTRAINT ${quoteIdentifier(primaryKey.name)} PRIMARY KEY (` +
        `${primaryKey.columns.map(quoteIdentifier).join(",")})`
    );
  }
  for (const unique of Object.values(table.uniqueConstraints || {})) {
    definitions.push(
      `CONSTRAINT ${quoteIdentifier(unique.name)} UNIQUE (` +
        `${unique.columns.map(quoteIdentifier).join(",")})`
    );
  }
  for (const index of Object.values(table.indexes || {})) {
    const prefix = index.isUnique ? "UNIQUE INDEX" : "INDEX";
    definitions.push(
      `${prefix} ${quoteIdentifier(index.name)} (` +
        `${index.columns.map(indexColumnName).map(quoteIdentifier).join(",")})`
    );
  }
  if (Object.keys(table.foreignKeys || {}).length > 0) {
    throw new Error(`unexpected foreign keys in adopted table ${table.name}`);
  }
  return `CREATE TABLE ${quoteIdentifier(table.name)} (\n  ${definitions.join(",\n  ")}\n)`;
}

async function materializeAdopted0108Tables(conn) {
  for (const tableName of ADOPTED_0108_TABLES) {
    const snapshotTable = snapshot0108.tables[tableName];
    if (!snapshotTable) {
      throw new Error(`0108 snapshot is missing adopted table ${tableName}`);
    }
    const existingColumns = await tableColumns(conn, tableName);
    const snapshotColumns = Object.values(snapshotTable.columns).map(
      column => column.name
    );
    if (existingColumns.length > 0) {
      if (JSON.stringify(existingColumns) !== JSON.stringify(snapshotColumns)) {
        throw new Error(
          `${tableName} exists but does not match the immutable 0108 snapshot`
        );
      }
      console.log(`[bridge:0108] ${tableName} already matches snapshot; no-op`);
      continue;
    }
    await conn.query(createTableSqlFromSnapshot(snapshotTable));
    console.log(`[bridge:0108] materialized ${tableName} from 0108 snapshot`);
  }
}

async function preserveCanonicalTable(conn) {
  const canonicalColumns = await tableColumns(conn, CANONICAL_TABLE);
  const parkedColumns = await tableColumns(conn, PARKED_CANONICAL_TABLE);

  if (parkedColumns.length > 0) {
    if (!isCanonicalShape(parkedColumns)) {
      throw new Error(
        `${PARKED_CANONICAL_TABLE} exists but is not the canonical match table`
      );
    }
    if (canonicalColumns.length === 0 || isEspnShape(canonicalColumns)) {
      console.log("[bridge:0104] canonical table is already parked; no-op");
      return;
    }
    throw new Error(
      "both canonical and parked canonical tables exist in an ambiguous state"
    );
  }

  if (!isCanonicalShape(canonicalColumns)) {
    throw new Error(
      `${CANONICAL_TABLE} is missing or does not have the verified canonical shape`
    );
  }

  await conn.query(
    `RENAME TABLE \`${CANONICAL_TABLE}\` TO \`${PARKED_CANONICAL_TABLE}\``
  );
  console.log(
    `[bridge:0104] parked ${CANONICAL_TABLE} as ${PARKED_CANONICAL_TABLE}`
  );
}

async function restoreCanonicalTable(conn) {
  const canonicalColumns = await tableColumns(conn, CANONICAL_TABLE);
  const parkedColumns = await tableColumns(conn, PARKED_CANONICAL_TABLE);

  if (parkedColumns.length === 0) {
    if (isCanonicalShape(canonicalColumns)) {
      console.log("[bridge:0107] canonical table is already restored; no-op");
      return;
    }
    throw new Error(
      `${PARKED_CANONICAL_TABLE} is missing before canonical restoration`
    );
  }
  if (!isCanonicalShape(parkedColumns)) {
    throw new Error(
      `${PARKED_CANONICAL_TABLE} does not have the verified canonical shape`
    );
  }
  if (canonicalColumns.length > 0) {
    throw new Error(
      `${CANONICAL_TABLE} still exists before canonical restoration`
    );
  }

  await conn.query(
    `RENAME TABLE \`${PARKED_CANONICAL_TABLE}\` TO \`${CANONICAL_TABLE}\``
  );
  console.log(`[bridge:0107] restored ${CANONICAL_TABLE}`);
}

async function validateCanonicalPostcondition(conn) {
  const canonicalColumns = await tableColumns(conn, CANONICAL_TABLE);
  const parkedColumns = await tableColumns(conn, PARKED_CANONICAL_TABLE);
  if (!isCanonicalShape(canonicalColumns) || parkedColumns.length > 0) {
    throw new Error("canonical wc2026_matches postcondition failed");
  }
}

const conn = await mysql.createConnection({ uri: DATABASE_URL });
try {
  const [journalTables] = await conn.query(
    `SELECT COUNT(*) AS count
       FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = '__drizzle_migrations'`
  );
  const journalExists = Number(journalTables[0].count) === 1;
  let rows = [];
  if (journalExists) {
    [rows] = await conn.query(
      "SELECT hash, created_at FROM `__drizzle_migrations` ORDER BY created_at DESC"
    );
  }

  const lastApplied = rows.length ? Number(rows[0].created_at) : -1;
  const duplicateCounts = new Map();
  let acceptedLegacyRows = 0;
  for (const row of rows) {
    const createdAt = Number(row.created_at);
    const migration = migrationByWhen.get(createdAt);
    if (!migration) {
      if (legacyJournalRows.has(`${createdAt}:${String(row.hash)}`)) {
        acceptedLegacyRows += 1;
        continue;
      }
      throw new Error(
        `journal row created_at=${createdAt} is absent from both the repository journal and the pinned legacy manifest`
      );
    }
    if (String(row.hash) !== String(migration.hash)) {
      throw new Error(`journal hash mismatch at created_at=${createdAt}`);
    }
    duplicateCounts.set(createdAt, (duplicateCounts.get(createdAt) || 0) + 1);
  }
  const exactDuplicates = [...duplicateCounts.entries()].filter(
    ([, count]) => count > 1
  );
  if (exactDuplicates.length > 0) {
    console.log(
      `[reconciled-migrate] observed ${exactDuplicates.length} exact duplicate journal timestamp(s); ` +
        "hashes match immutable migration files"
    );
  }
  if (acceptedLegacyRows > 0) {
    console.log(
      `[reconciled-migrate] verified ${acceptedLegacyRows} exact row(s) from the pinned legacy journal manifest`
    );
  }
  if (lastApplied > targetWhen) {
    throw new Error(
      `target ${targetTag} (${targetWhen}) is older than the database journal (${lastApplied})`
    );
  }
  if (
    lastApplied >= Number(migrationByTag.get(RESTORE_AFTER_TAG).folderMillis)
  ) {
    await validateCanonicalPostcondition(conn);
  }

  const pending = selectedMigrations.filter(
    migration => Number(migration.folderMillis) > lastApplied
  );
  console.log(
    `[reconciled-migrate] mode=${MODE}; journalRows=${rows.length}; ` +
      `lastApplied=${lastApplied}; target=${targetTag}; pending=${pending.length}`
  );
  for (const migration of pending) {
    const tag = tagByWhen.get(Number(migration.folderMillis));
    console.log(
      `  - ${tag} when=${migration.folderMillis} hash=${String(migration.hash).slice(0, 16)}…`
    );
  }

  if (MODE === "plan") {
    console.log(
      "[reconciled-migrate] PLAN ONLY: no schema or journal writes performed"
    );
  } else {
    await conn.query(
      "CREATE TABLE IF NOT EXISTS `__drizzle_migrations` " +
        "(id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)"
    );

    if (
      lastApplied >=
        Number(migrationByTag.get(RESTORE_AFTER_TAG).folderMillis) &&
      lastApplied < targetWhen
    ) {
      const parkedColumns = await tableColumns(conn, PARKED_CANONICAL_TABLE);
      if (parkedColumns.length > 0) {
        await restoreCanonicalTable(conn);
      }
    }

    for (const migration of pending) {
      const tag = tagByWhen.get(Number(migration.folderMillis));
      if (tag === PRESERVE_BEFORE_TAG) {
        await preserveCanonicalTable(conn);
      }
      if (tag === ADOPT_BEFORE_TAG) {
        await materializeAdopted0108Tables(conn);
      }

      console.log(`[reconciled-migrate] applying ${tag}`);
      for (const statement of migration.sql) {
        if (statement.trim()) {
          await conn.query(statement);
        }
      }
      await conn.query(
        "INSERT INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES (?, ?)",
        [migration.hash, Number(migration.folderMillis)]
      );

      if (tag === RESTORE_AFTER_TAG) {
        await restoreCanonicalTable(conn);
      }
    }

    const [after] = await conn.query(
      "SELECT created_at FROM `__drizzle_migrations` ORDER BY created_at DESC LIMIT 1"
    );
    const newMax = Number(after[0].created_at);
    if (newMax !== targetWhen) {
      throw new Error(
        `journal ended at ${newMax}; expected target ${targetWhen}`
      );
    }

    await validateCanonicalPostcondition(conn);
    console.log(
      `[reconciled-migrate] PASS: journal and canonical table reached ${targetTag}`
    );
  }
} catch (error) {
  console.error(
    `::error::${error instanceof Error ? error.message : String(error)}`
  );
  process.exitCode = 1;
} finally {
  await conn.end();
}
