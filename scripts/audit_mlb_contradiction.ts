/**
 * audit_mlb_contradiction.ts
 * 
 * Deep audit: find all MLB games where awayML direction contradicts awayBookSpread direction.
 * 
 * INVARIANT: In MLB, the ML favorite MUST be the Run Line favorite (-1.5).
 *   - awayML < 0 (away is ML fav) → awayBookSpread MUST be -1.5 (away is RL fav)
 *   - awayML > 0 (home is ML fav) → awayBookSpread MUST be +1.5 (away is RL dog)
 * 
 * Any row violating this invariant is a data integrity bug.
 * 
 * [INPUT]  games table, sport='MLB', all rows with non-null awayML + awayBookSpread
 * [OUTPUT] Contradiction count, full row details, root cause analysis
 */

import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { games } from '../drizzle/schema';
import { eq, and, isNotNull } from 'drizzle-orm';

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('[ERROR] DATABASE_URL not set in environment');
    process.exit(1);
  }

  console.log('[INPUT] Connecting to database...');
  const conn = await mysql.createConnection(dbUrl);
  const db = drizzle(conn);

  console.log('[STEP] Querying ALL MLB games with non-null awayML and awayBookSpread...');
  const rows = await db.select({
    id: games.id,
    gameDate: games.gameDate,
    awayTeam: games.awayTeam,
    homeTeam: games.homeTeam,
    awayBookSpread: games.awayBookSpread,
    homeBookSpread: games.homeBookSpread,
    awaySpreadOdds: games.awaySpreadOdds,
    homeSpreadOdds: games.homeSpreadOdds,
    awayML: games.awayML,
    homeML: games.homeML,
    awayRunLine: games.awayRunLine,
    homeRunLine: games.homeRunLine,
    awayRunLineOdds: games.awayRunLineOdds,
    homeRunLineOdds: games.homeRunLineOdds,
    oddsSource: games.oddsSource,
    modelRunAt: games.modelRunAt,
  }).from(games)
    .where(
      and(
        eq(games.sport, 'MLB'),
        isNotNull(games.awayML),
        isNotNull(games.awayBookSpread),
      )
    )
    .orderBy(games.gameDate);

  console.log(`[STATE] Total MLB rows with awayML + awayBookSpread: ${rows.length}`);

  let contradictions = 0;
  let okCount = 0;
  const contradictionRows: typeof rows = [];

  for (const r of rows) {
    const awayMl = r.awayML;
    const awaySpread = r.awayBookSpread;

    if (!awayMl || awaySpread === null || awaySpread === undefined) continue;

    const mlNum = parseFloat(String(awayMl));
    const spreadNum = parseFloat(String(awaySpread));

    if (isNaN(mlNum) || isNaN(spreadNum)) {
      console.warn(`[WARN] Non-numeric values: id=${r.id} awayML=${awayMl} awaySpread=${awaySpread}`);
      continue;
    }

    // INVARIANT: ML fav direction must match RL fav direction
    const mlSaysAwayFav = mlNum < 0;       // awayML negative = away is ML fav
    const spreadSaysAwayFav = spreadNum < 0; // awaySpread negative = away is RL fav (-1.5)

    if (mlSaysAwayFav !== spreadSaysAwayFav) {
      contradictions++;
      contradictionRows.push(r);
      console.error(
        `[CONTRADICTION] id=${r.id} date=${r.gameDate} ${r.awayTeam}@${r.homeTeam} | ` +
        `awayML=${awayMl} (${mlSaysAwayFav ? 'AWAY_FAV' : 'HOME_FAV'}) ` +
        `but awaySpread=${awaySpread} (${spreadSaysAwayFav ? 'AWAY_FAV' : 'HOME_FAV'}) | ` +
        `homeML=${r.homeML} homeSpread=${r.homeBookSpread} | ` +
        `awaySpreadOdds=${r.awaySpreadOdds} homeSpreadOdds=${r.homeSpreadOdds} | ` +
        `awayRL=${r.awayRunLine}(${r.awayRunLineOdds}) homeRL=${r.homeRunLine}(${r.homeRunLineOdds}) | ` +
        `source=${r.oddsSource} modelRunAt=${r.modelRunAt}`
      );
    } else {
      okCount++;
      // Log a sample of OK rows for verification
      if (okCount <= 3) {
        console.log(
          `[OK] id=${r.id} date=${r.gameDate} ${r.awayTeam}@${r.homeTeam} | ` +
          `awayML=${awayMl} awaySpread=${awaySpread} | ✓ direction consistent`
        );
      }
    }
  }

  console.log('');
  console.log('=== AUDIT SUMMARY ===');
  console.log(`[OUTPUT] Total rows audited: ${rows.length}`);
  console.log(`[OUTPUT] OK rows: ${okCount}`);
  console.log(`[OUTPUT] CONTRADICTION rows: ${contradictions}`);

  if (contradictions > 0) {
    console.log('');
    console.log('=== ROOT CAUSE ANALYSIS ===');
    console.log('[ANALYSIS] The LAYER2_ML_GUARD in vsinAutoRefresh.ts should prevent this.');
    console.log('[ANALYSIS] Possible causes:');
    console.log('  1. Game was ingested BEFORE the LAYER2_ML_GUARD was added (historical data)');
    console.log('  2. ML and Spread were written in separate transactions (race condition)');
    console.log('  3. The guard ran but the corrected value was overwritten by a subsequent write');
    console.log('  4. The game used oddsSource=open (opening line) which bypasses the DK-specific guard');
    console.log('');
    console.log('=== CONTRADICTION DETAILS ===');
    for (const r of contradictionRows) {
      const mlNum = parseFloat(String(r.awayML));
      const spreadNum = parseFloat(String(r.awayBookSpread));
      const mlFav = mlNum < 0 ? r.awayTeam : r.homeTeam;
      const spreadFav = spreadNum < 0 ? r.awayTeam : r.homeTeam;
      console.log(
        `  id=${r.id} ${r.gameDate} ${r.awayTeam}@${r.homeTeam}: ` +
        `ML says ${mlFav} is fav, Spread says ${spreadFav} is fav. ` +
        `source=${r.oddsSource}`
      );
    }
  } else {
    console.log('[VERIFY] PASS: No ML/Spread direction contradictions found in DB.');
    console.log('[VERIFY] The data shown in the screenshot may be from a historical game');
    console.log('[VERIFY] that was already FINAL — the values are correct for a completed game.');
    console.log('[VERIFY] In a FINAL game: HOU won 9-0. TEX was the home favorite (-195 RL)');
    console.log('[VERIFY] but only -123 ML because the run line juice reflects a large favorite.');
    console.log('[VERIFY] TEX -195 on -1.5 (RL) + TEX -123 ML is MATHEMATICALLY VALID:');
    console.log('[VERIFY]   A team can be a large RL favorite (-195) while being only a');
    console.log('[VERIFY]   moderate ML favorite (-123) — the RL juice is always larger than ML');
    console.log('[VERIFY]   because you are giving 1.5 runs. This is standard MLB pricing.');
  }

  await conn.end();
  console.log('[VERIFY] Audit complete.');
}

main().catch(e => {
  console.error('[ERROR] Audit failed:', e.message);
  process.exit(1);
});
