/**
 * heal_mlb_rl_odds_inversion.ts
 *
 * Self-heal script: corrects MLB rows where the run line odds are inverted
 * relative to the run line direction.
 *
 * ROOT CAUSE: LAYER2_ML_GUARD in vsinAutoRefresh.ts flipped the run line
 * direction (_finalAwayRunLine) but did NOT swap awaySpreadOdds/homeSpreadOdds
 * or awayRunLineOdds/homeRunLineOdds. This produced the impossible display:
 *   SD -203 on -1.5 but only -125 ML (PHI@SD)
 *
 * INVARIANT: For any MLB game:
 *   - The team on -1.5 (RL fav) MUST have more-negative odds than the ML fav odds
 *   - The team on +1.5 (RL dog) MUST have more-positive odds than the ML dog odds
 *   - Equivalently: awaySpreadOdds < homeSpreadOdds iff awayBookSpread < 0
 *
 * DETECTION: awaySpreadOdds < homeSpreadOdds (fav odds on away) but awayBookSpread > 0 (away is dog)
 *   → odds are inverted relative to the spread direction
 *
 * FIX: swap awaySpreadOdds ↔ homeSpreadOdds and awayRunLineOdds ↔ homeRunLineOdds
 */

import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { games } from '../drizzle/schema';
import { and, eq, isNotNull } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) { console.error('[ERROR] DATABASE_URL not set'); process.exit(1); }

  console.log('[INPUT] Connecting to database...');
  const conn = await mysql.createConnection(dbUrl);
  const db = drizzle(conn);

  // ── Step 1: Find all MLB games with run line odds inversion ─────────────────
  console.log('[STEP] Querying all MLB games with spread and spread odds...');
  const allMlb = await db.select({
    id: games.id,
    gameDate: games.gameDate,
    awayTeam: games.awayTeam,
    homeTeam: games.homeTeam,
    awayML: games.awayML,
    homeML: games.homeML,
    awayBookSpread: games.awayBookSpread,
    homeBookSpread: games.homeBookSpread,
    awaySpreadOdds: games.awaySpreadOdds,
    homeSpreadOdds: games.homeSpreadOdds,
    awayRunLineOdds: games.awayRunLineOdds,
    homeRunLineOdds: games.homeRunLineOdds,
  }).from(games)
    .where(
      and(
        eq(games.sport, 'MLB'),
        isNotNull(games.awayBookSpread),
        isNotNull(games.awaySpreadOdds),
        isNotNull(games.homeSpreadOdds),
      )
    );

  console.log(`[STATE] Total MLB games with spread data: ${allMlb.length}`);

  let invertedCount = 0;
  let healedCount = 0;
  let errors = 0;

  for (const r of allMlb) {
    const awayBS = parseFloat(String(r.awayBookSpread ?? 'NaN'));
    const awaySO = parseFloat(String(r.awaySpreadOdds ?? 'NaN'));
    const homeSO = parseFloat(String(r.homeSpreadOdds ?? 'NaN'));

    if (isNaN(awayBS) || isNaN(awaySO) || isNaN(homeSO)) continue;

    // INVARIANT: if awayBookSpread < 0 (away is RL fav), then awaySpreadOdds
    // should be MORE negative than homeSpreadOdds (fav has worse odds).
    // Inversion: awayBS < 0 (away is fav) but awaySO > homeSO (away has better/dog odds)
    // OR: awayBS > 0 (away is dog) but awaySO < homeSO (away has worse/fav odds)
    const awayIsFavBySpread = awayBS < 0;
    const awayHasFavOdds = awaySO < homeSO; // more negative = fav odds

    if (awayIsFavBySpread !== awayHasFavOdds) {
      invertedCount++;
      console.log(
        `[VERIFY] INVERTED id=${r.id} ${r.gameDate} ${r.awayTeam}@${r.homeTeam}: ` +
        `awayBS=${awayBS} awaySO=${awaySO} homeSO=${homeSO} ` +
        `→ swapping awaySpreadOdds↔homeSpreadOdds and awayRunLineOdds↔homeRunLineOdds`
      );

      try {
        await db.update(games)
          .set({
            awaySpreadOdds: r.homeSpreadOdds,
            homeSpreadOdds: r.awaySpreadOdds,
            awayRunLineOdds: r.homeRunLineOdds,
            homeRunLineOdds: r.awayRunLineOdds,
          })
          .where(eq(games.id, r.id));
        healedCount++;
        console.log(`[STEP] HEALED id=${r.id}: awaySpreadOdds=${r.awaySpreadOdds}→${r.homeSpreadOdds} homeSpreadOdds=${r.homeSpreadOdds}→${r.awaySpreadOdds}`);
      } catch (err: any) {
        errors++;
        console.error(`[ERROR] Failed to heal id=${r.id}: ${err.message}`);
      }
    }
  }

  console.log(`\n[OUTPUT] Audit complete:`);
  console.log(`[OUTPUT]   Total MLB rows scanned: ${allMlb.length}`);
  console.log(`[OUTPUT]   Inverted rows found:    ${invertedCount}`);
  console.log(`[OUTPUT]   Rows healed:            ${healedCount}`);
  console.log(`[OUTPUT]   Errors:                 ${errors}`);

  // ── Step 2: Post-heal verification ─────────────────────────────────────────
  console.log('\n[STEP] Post-heal verification: re-scanning for remaining inversions...');
  const postHeal = await db.select({
    id: games.id,
    awayBookSpread: games.awayBookSpread,
    awaySpreadOdds: games.awaySpreadOdds,
    homeSpreadOdds: games.homeSpreadOdds,
  }).from(games)
    .where(
      and(
        eq(games.sport, 'MLB'),
        isNotNull(games.awayBookSpread),
        isNotNull(games.awaySpreadOdds),
        isNotNull(games.homeSpreadOdds),
      )
    );

  let remaining = 0;
  for (const r of postHeal) {
    const awayBS = parseFloat(String(r.awayBookSpread ?? 'NaN'));
    const awaySO = parseFloat(String(r.awaySpreadOdds ?? 'NaN'));
    const homeSO = parseFloat(String(r.homeSpreadOdds ?? 'NaN'));
    if (isNaN(awayBS) || isNaN(awaySO) || isNaN(homeSO)) continue;
    const awayIsFavBySpread = awayBS < 0;
    const awayHasFavOdds = awaySO < homeSO;
    if (awayIsFavBySpread !== awayHasFavOdds) remaining++;
  }

  if (remaining === 0) {
    console.log('[VERIFY] PASS — Zero remaining inverted rows after heal.');
  } else {
    console.error(`[VERIFY] FAIL — ${remaining} rows still inverted after heal. Manual inspection required.`);
  }

  await conn.end();
  console.log('[VERIFY] Self-heal complete.');
}

main().catch(e => { console.error('[ERROR]', e.message); process.exit(1); });
