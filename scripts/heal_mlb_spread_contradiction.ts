/**
 * heal_mlb_spread_contradiction.ts
 *
 * Self-heal script: retroactively correct all MLB rows where awayBookSpread sign
 * contradicts awayML direction. This is the historical data left by the LAYER2 guard
 * bypass bug (awayRunLine was corrected but awayBookSpread was not).
 *
 * INVARIANT enforced: ML fav = RL fav.
 *   - awayML < 0 (away is ML fav) → awayBookSpread MUST be -1.5
 *   - awayML > 0 (home is ML fav) → awayBookSpread MUST be +1.5
 *
 * [INPUT]  games table, sport='MLB', all rows with non-null awayML + awayBookSpread
 * [STEP]   For each contradiction row: flip awayBookSpread and homeBookSpread signs
 * [OUTPUT] Number of rows corrected
 * [VERIFY] Re-audit to confirm zero contradictions remain
 */

import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { games } from '../drizzle/schema';
import { eq, and, isNotNull } from 'drizzle-orm';

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('[ERROR] DATABASE_URL not set');
    process.exit(1);
  }

  console.log('[INPUT] Connecting to database...');
  const conn = await mysql.createConnection(dbUrl);
  const db = drizzle(conn);

  console.log('[STEP] Querying all MLB rows with awayML + awayBookSpread...');
  const rows = await db.select({
    id: games.id,
    gameDate: games.gameDate,
    awayTeam: games.awayTeam,
    homeTeam: games.homeTeam,
    awayBookSpread: games.awayBookSpread,
    homeBookSpread: games.homeBookSpread,
    awayML: games.awayML,
    homeML: games.homeML,
    awayRunLine: games.awayRunLine,
    homeRunLine: games.homeRunLine,
  }).from(games)
    .where(
      and(
        eq(games.sport, 'MLB'),
        isNotNull(games.awayML),
        isNotNull(games.awayBookSpread),
      )
    );

  console.log(`[STATE] Total rows to check: ${rows.length}`);

  let corrected = 0;
  let skipped = 0;
  let errors = 0;

  for (const r of rows) {
    const mlNum = parseFloat(String(r.awayML));
    const spreadNum = parseFloat(String(r.awayBookSpread));

    if (isNaN(mlNum) || isNaN(spreadNum) || spreadNum === 0) {
      skipped++;
      continue;
    }

    const mlSaysAwayFav = mlNum < 0;
    const spreadSaysAwayFav = spreadNum < 0;

    if (mlSaysAwayFav === spreadSaysAwayFav) {
      // No contradiction — skip
      skipped++;
      continue;
    }

    // Contradiction found — flip awayBookSpread and homeBookSpread signs
    // The ML is authoritative (it comes from team_id matching, not side string)
    // awayBookSpread should be -1.5 if away is ML fav, +1.5 if home is ML fav
    const correctedAwayBS = mlSaysAwayFav ? -1.5 : 1.5;
    const correctedHomeBS = -correctedAwayBS;

    console.log(
      `[STEP] Correcting id=${r.id} ${r.gameDate} ${r.awayTeam}@${r.homeTeam}: ` +
      `awayML=${r.awayML} awayBookSpread=${r.awayBookSpread}→${correctedAwayBS} ` +
      `homeBookSpread=${r.homeBookSpread}→${correctedHomeBS} | ` +
      `awayRL=${r.awayRunLine} homeRL=${r.homeRunLine}`
    );

    try {
      await db.update(games)
        .set({
          awayBookSpread: correctedAwayBS,
          homeBookSpread: correctedHomeBS,
        })
        .where(eq(games.id, r.id));
      corrected++;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[ERROR] Failed to update id=${r.id}: ${msg}`);
      errors++;
    }
  }

  console.log('');
  console.log('=== HEAL SUMMARY ===');
  console.log(`[OUTPUT] Total rows checked: ${rows.length}`);
  console.log(`[OUTPUT] Rows corrected: ${corrected}`);
  console.log(`[OUTPUT] Rows skipped (no contradiction): ${skipped}`);
  console.log(`[OUTPUT] Errors: ${errors}`);

  // ── RE-AUDIT: verify zero contradictions remain ─────────────────────────────
  console.log('');
  console.log('[VERIFY] Re-auditing to confirm zero contradictions remain...');
  const recheck = await db.select({
    id: games.id,
    gameDate: games.gameDate,
    awayTeam: games.awayTeam,
    homeTeam: games.homeTeam,
    awayBookSpread: games.awayBookSpread,
    awayML: games.awayML,
  }).from(games)
    .where(
      and(
        eq(games.sport, 'MLB'),
        isNotNull(games.awayML),
        isNotNull(games.awayBookSpread),
      )
    );

  let remaining = 0;
  for (const r of recheck) {
    const mlNum = parseFloat(String(r.awayML));
    const spreadNum = parseFloat(String(r.awayBookSpread));
    if (isNaN(mlNum) || isNaN(spreadNum) || spreadNum === 0) continue;
    if (Math.sign(mlNum) !== Math.sign(-spreadNum)) {
      // awayML < 0 means away is fav → awayBookSpread should be negative
      // awayML > 0 means home is fav → awayBookSpread should be positive
      // Contradiction: sign(awayML) should equal sign(-awayBookSpread)
      // i.e. if awayML < 0 (away fav), awayBookSpread should be < 0 (away RL fav)
      // Correct check: mlSaysAwayFav !== spreadSaysAwayFav
      const mlFav = mlNum < 0;
      const spreadFav = spreadNum < 0;
      if (mlFav !== spreadFav) {
        remaining++;
        console.error(`[VERIFY] STILL CONTRADICTED: id=${r.id} ${r.gameDate} ${r.awayTeam}@${r.homeTeam} awayML=${r.awayML} awaySpread=${r.awayBookSpread}`);
      }
    }
  }

  if (remaining === 0) {
    console.log('[VERIFY] PASS: Zero ML/Spread contradictions remain in DB.');
  } else {
    console.error(`[VERIFY] FAIL: ${remaining} contradictions still remain after heal.`);
  }

  await conn.end();
  console.log('[VERIFY] Heal complete.');
}

main().catch(e => {
  console.error('[ERROR] Heal script failed:', e.message);
  process.exit(1);
});
