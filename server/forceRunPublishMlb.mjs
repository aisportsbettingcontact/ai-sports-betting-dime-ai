/**
 * forceRunPublishMlb.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Force-publish MLB games for a specific date that have already been modeled
 * but were never flipped to `publishedModel=true` / `publishedToFeed=true` by
 * the normal automated publishing cycle.
 *
 * Mirrors the logic of `bulkApproveModels()` and `publishAllStagingGames()`
 * in server/db.ts, but runs as a standalone CLI utility so it can be invoked
 * manually against a specific date without going through the tRPC layer.
 *
 * Usage:
 *   npx tsx server/forceRunPublishMlb.mjs 2026-07-10
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as dotenv from 'dotenv';
dotenv.config();

import mysql from 'mysql2/promise';

const TAG = '[ForceRunPublishMlb]';

async function main() {
  const gameDate = process.argv[2];

  if (!gameDate) {
    console.error(`${TAG} [ERROR] Missing required date argument.`);
    console.error(`${TAG} Usage: npx tsx server/forceRunPublishMlb.mjs YYYY-MM-DD`);
    process.exit(1);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(gameDate)) {
    console.error(`${TAG} [ERROR] Invalid date format "${gameDate}". Expected YYYY-MM-DD.`);
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error(`${TAG} [ERROR] DATABASE_URL is not set. Aborting.`);
    process.exit(1);
  }

  console.log(`${TAG} [INPUT] sport=MLB gameDate=${gameDate}`);

  let pool;
  try {
    pool = mysql.createPool({
      uri: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      connectionLimit: 2,
      connectTimeout: 10000,
    });

    const conn = await pool.getConnection();
    console.log(`${TAG} [STATE] Connected to database`);

    try {
      // ─── Step 1: Approve models (mirrors bulkApproveModels) ─────────────────
      // Publish the model itself for any MLB game on this date that has model
      // output (modelTotal populated) but hasn't been approved yet.
      console.log(`${TAG} [STEP 1] Approving modeled MLB games for ${gameDate}...`);
      const [approveResult] = await conn.execute(
        `UPDATE games
         SET publishedModel = 1
         WHERE gameDate = ?
           AND sport = 'MLB'
           AND modelTotal IS NOT NULL
           AND publishedModel = 0`,
        [gameDate]
      );
      const approvedCount = approveResult.affectedRows ?? 0;
      console.log(`${TAG} [OUTPUT] publishedModel set true on ${approvedCount} game(s)`);

      // ─── Step 2: Publish to feed (mirrors publishAllStagingGames) ───────────
      // Put every MLB game on this date on the public feed, regardless of
      // whether it was previously gated behind staging/odds checks.
      console.log(`${TAG} [STEP 2] Publishing MLB games to feed for ${gameDate}...`);
      const [publishResult] = await conn.execute(
        `UPDATE games
         SET publishedToFeed = 1
         WHERE gameDate = ?
           AND sport = 'MLB'
           AND publishedToFeed = 0`,
        [gameDate]
      );
      const publishedCount = publishResult.affectedRows ?? 0;
      console.log(`${TAG} [OUTPUT] publishedToFeed set true on ${publishedCount} game(s)`);

      // ─── Verify ──────────────────────────────────────────────────────────────
      const [rows] = await conn.execute(
        `SELECT id, awayTeam, homeTeam, modelTotal, publishedModel, publishedToFeed
         FROM games
         WHERE gameDate = ? AND sport = 'MLB'
         ORDER BY startTimeEst ASC`,
        [gameDate]
      );

      console.log(`\n${TAG} [VERIFY] ${rows.length} MLB game(s) found for ${gameDate}:`);
      for (const r of rows) {
        console.log(
          `  [${r.id}] ${r.awayTeam} @ ${r.homeTeam} | modelTotal=${r.modelTotal ?? 'NULL'} | ` +
          `publishedModel=${r.publishedModel} | publishedToFeed=${r.publishedToFeed}`
        );
      }

      console.log(`\n${TAG} ══════════════════════════════════════════════`);
      console.log(`${TAG} COMPLETE — date=${gameDate}`);
      console.log(`${TAG} Models approved:     ${approvedCount}`);
      console.log(`${TAG} Published to feed:   ${publishedCount}`);
      console.log(`${TAG} ══════════════════════════════════════════════`);
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error(`${TAG} [ERROR] Failed to force-publish MLB games for ${gameDate}:`, err.message);
    if (err.stack) console.error(err.stack);
    process.exitCode = 1;
  } finally {
    if (pool) await pool.end();
  }
}

main().catch((err) => {
  console.error(`${TAG} [FATAL] Unhandled error:`, err);
  process.exit(1);
});
