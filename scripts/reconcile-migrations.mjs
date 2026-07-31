#!/usr/bin/env node
/**
 * reconcile-migrations.mjs — baseline drizzle's __drizzle_migrations journal to
 * match the live database, so `drizzle-kit migrate` stops colliding.
 *
 * WHY THIS EXISTS
 *   Production's __drizzle_migrations journal is behind the live schema:
 *   migrations 0112–0115 had their changes applied via `drizzle-kit push`
 *   (0112 CREATE dime_chat_messages, 0113 app_users discord unique, 0114 MLB
 *   doubleheader identity) or out-of-band (0115's DROPs were run by the one-shot
 *   drop workflow), but none were RECORDED as applied. So `drizzle-kit migrate`
 *   replays 0112, hits "dime_chat_messages already exists", and dies before
 *   reaching anything newer. This legacy repair is intentionally capped at
 *   0115 and can never mark a newer migration applied.
 *
 * WHAT IT DOES
 *   Mirrors drizzle's own migrate decision: a migration is "applied" when its
 *   folderMillis (the journal `when`) is greater than the max created_at already
 *   recorded. It inserts a journal row (hash, created_at=folderMillis) only for
 *   the verified 0112–0115 baseline window, WITHOUT running its SQL — because
 *   the SQL's effect is already present in the DB. Hashes are computed by
 *   drizzle's own readMigrationFiles, so they are byte-identical to what a real
 *   migrate run would have written.
 *
 * SAFETY
 *   - Default mode is dry-run: it prints exactly which migrations it would
 *     baseline and writes nothing.
 *   - It never runs migration SQL and never touches application tables — only
 *     inserts bookkeeping rows into __drizzle_migrations.
 *   - It is idempotent: migrations already recorded (by hash) are skipped, so
 *     re-running is a no-op.
 *   - Marking a migration applied is only correct if its change is already live.
 *     Review the dry-run list before applying. The accompanying workflow then
 *     runs the reconciled migrator in plan mode; it never applies newer SQL.
 *
 * ENV: DATABASE_URL (required), MODE = "dry-run" (default) | "apply".
 *      MODE=apply also requires CONFIRM=RECONCILE.
 */
import { readMigrationFiles } from "drizzle-orm/migrator";
import { readFileSync } from "node:fs";
import mysql from "mysql2/promise";

const MODE = (process.env.MODE || "dry-run").trim();
const CONFIRM = (process.env.CONFIRM || "").trim();
const url = process.env.DATABASE_URL;
const BASELINE_FROM_TAG = "0112_graceful_stranger";
const BASELINE_THROUGH_TAG = "0115_condemned_warhawk";
if (!url) {
  console.error("::error::DATABASE_URL is not set");
  process.exit(1);
}
if (!["dry-run", "apply"].includes(MODE)) {
  console.error("::error::MODE must be dry-run or apply");
  process.exit(1);
}
if (MODE === "apply" && CONFIRM !== "RECONCILE") {
  console.error("::error::MODE=apply requires CONFIRM=RECONCILE");
  process.exit(1);
}

// drizzle-parity migration metadata: { sql, bps, folderMillis, hash }
const migrations = readMigrationFiles({ migrationsFolder: "./drizzle" });
const journal = JSON.parse(
  readFileSync("./drizzle/meta/_journal.json", "utf8")
);
const tagByWhen = new Map(journal.entries.map(e => [Number(e.when), e.tag]));
const migrationByTag = new Map(
  migrations.map(migration => [
    tagByWhen.get(Number(migration.folderMillis)),
    migration,
  ])
);
const baselineFromWhen = Number(
  migrationByTag.get(BASELINE_FROM_TAG).folderMillis
);
const baselineThroughWhen = Number(
  migrationByTag.get(BASELINE_THROUGH_TAG).folderMillis
);

// Mirror the app/CLI connection (bare uri — same as server/db.ts and drizzle.config.ts).
const conn = await mysql.createConnection({ uri: url });
try {
  // Same DDL drizzle's mysql2 migrator uses; no-op if the table already exists.
  await conn.query(
    "CREATE TABLE IF NOT EXISTS `__drizzle_migrations` (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)"
  );

  const [rows] = await conn.query(
    "SELECT hash, created_at FROM `__drizzle_migrations` ORDER BY created_at DESC"
  );
  const lastApplied = rows.length ? Number(rows[0].created_at) : -1;
  const appliedHashes = new Set(rows.map(r => r.hash));

  const missing = migrations
    .filter(migration => {
      const when = Number(migration.folderMillis);
      return (
        when >= baselineFromWhen &&
        when <= baselineThroughWhen &&
        when > lastApplied &&
        !appliedHashes.has(migration.hash)
      );
    })
    .sort((a, b) => Number(a.folderMillis) - Number(b.folderMillis));

  console.log(
    `[recon] journal rows in DB: ${rows.length}; recorded through created_at=${lastApplied} ` +
      `(${tagByWhen.get(lastApplied) ?? "n/a"})`
  );
  console.log(
    `[recon] immutable baseline window: ${BASELINE_FROM_TAG} through ${BASELINE_THROUGH_TAG}`
  );
  console.log(
    `[recon] migrations to baseline (mark applied WITHOUT running SQL): ${missing.length}`
  );
  for (const m of missing) {
    console.log(
      `        - ${tagByWhen.get(Number(m.folderMillis)) ?? "?"}  when=${m.folderMillis}  hash=${String(m.hash).slice(0, 16)}…`
    );
  }

  if (missing.length === 0) {
    console.log(
      "[recon] Nothing to baseline — journal already current. No-op."
    );
    process.exit(0);
  }

  if (MODE !== "apply") {
    console.log(
      "[recon] DRY-RUN: no rows written. Re-run with MODE=apply CONFIRM=RECONCILE to write these rows."
    );
    process.exit(0);
  }

  for (const m of missing) {
    await conn.query(
      "INSERT INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES (?, ?)",
      [m.hash, Number(m.folderMillis)]
    );
    console.log(
      `[recon] inserted ${tagByWhen.get(Number(m.folderMillis)) ?? m.folderMillis}`
    );
  }

  const [after] = await conn.query(
    "SELECT created_at FROM `__drizzle_migrations` ORDER BY created_at DESC LIMIT 1"
  );
  const newMax = Number(after[0].created_at);
  console.log(
    `[recon] new max created_at=${newMax}; baseline through=${baselineThroughWhen}`
  );
  if (newMax !== baselineThroughWhen) {
    console.error(
      "::error::Reconcile incomplete — journal did not reach the 0115 baseline boundary."
    );
    process.exit(1);
  }
  console.log(
    "[recon] RECONCILED: __drizzle_migrations reached the verified 0115 boundary."
  );
} finally {
  await conn.end();
}
