/**
 * audit_phi_sd.ts
 *
 * Deep forensic audit of PHI@SD MLB game:
 * - Inspect all run line odds columns in DB
 * - Cross-check ML vs RL odds for mathematical consistency
 * - Identify any inversion or mismatch in awaySpreadOdds/homeSpreadOdds
 *
 * INVARIANT: For MLB, RL odds must be consistent with ML direction.
 * A -125 ML team should have RL odds around -130 to -145, NOT -203.
 * A +166 ML dog should have RL odds well above +100, NOT -123.
 */

import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { games } from '../drizzle/schema';
import { and, eq, like, or } from 'drizzle-orm';

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) { console.error('[ERROR] DATABASE_URL not set'); process.exit(1); }

  console.log('[INPUT] Connecting to database...');
  const conn = await mysql.createConnection(dbUrl);
  const db = drizzle(conn);

  // ── Step 1: Find PHI@SD game(s) ─────────────────────────────────────────────
  console.log('[STEP] Querying PHI@SD MLB games...');
  const rows = await db.select({
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
    awayRunLine: games.awayRunLine,
    homeRunLine: games.homeRunLine,
    awayRunLineOdds: games.awayRunLineOdds,
    homeRunLineOdds: games.homeRunLineOdds,
    awayModelSpread: games.awayModelSpread,
    homeModelSpread: games.homeModelSpread,
    awayModelSpreadOdds: games.awayModelSpreadOdds,
    homeModelSpreadOdds: games.homeModelSpreadOdds,
    modelRunAt: games.modelRunAt,
    oddsSource: games.oddsSource,
    sport: games.sport,
  }).from(games)
    .where(
      and(
        eq(games.sport, 'MLB'),
        or(
          and(like(games.awayTeam, 'phi%'), like(games.homeTeam, 'san-diego%')),
          and(like(games.awayTeam, 'san-diego%'), like(games.homeTeam, 'phi%')),
          and(like(games.awayTeam, 'philadelphia%'), like(games.homeTeam, 'san-diego%')),
          and(like(games.awayTeam, 'san-diego%'), like(games.homeTeam, 'philadelphia%')),
        )
      )
    );

  console.log(`[STATE] Found ${rows.length} PHI@SD MLB game(s)`);

  for (const r of rows) {
    console.log('\n=== GAME RECORD ===');
    console.log(`[STATE] id=${r.id} date=${r.gameDate} matchup=${r.awayTeam}@${r.homeTeam}`);
    console.log(`[STATE] oddsSource=${r.oddsSource} modelRunAt=${r.modelRunAt}`);
    console.log('');
    console.log('── BOOK MONEYLINE ──');
    console.log(`[STATE] awayML=${r.awayML}  homeML=${r.homeML}`);
    console.log('');
    console.log('── BOOK RUN LINE (awayBookSpread = display column) ──');
    console.log(`[STATE] awayBookSpread=${r.awayBookSpread}  homeBookSpread=${r.homeBookSpread}`);
    console.log(`[STATE] awaySpreadOdds=${r.awaySpreadOdds}  homeSpreadOdds=${r.homeSpreadOdds}`);
    console.log('');
    console.log('── BOOK RUN LINE (awayRunLine = model input column) ──');
    console.log(`[STATE] awayRunLine=${r.awayRunLine}  homeRunLine=${r.homeRunLine}`);
    console.log(`[STATE] awayRunLineOdds=${r.awayRunLineOdds}  homeRunLineOdds=${r.homeRunLineOdds}`);
    console.log('');
    console.log('── MODEL RUN LINE ──');
    console.log(`[STATE] awayModelSpread=${r.awayModelSpread}  homeModelSpread=${r.homeModelSpread}`);
    console.log(`[STATE] awayModelSpreadOdds=${r.awayModelSpreadOdds}  homeModelSpreadOdds=${r.homeModelSpreadOdds}`);
    console.log('');

    // ── Mathematical consistency checks ─────────────────────────────────────
    const awayML = parseFloat(String(r.awayML ?? 'NaN'));
    const homeML = parseFloat(String(r.homeML ?? 'NaN'));
    const awayBS = parseFloat(String(r.awayBookSpread ?? 'NaN'));
    const awaySO = parseFloat(String(r.awaySpreadOdds ?? 'NaN'));
    const homeSO = parseFloat(String(r.homeSpreadOdds ?? 'NaN'));
    const awayRLO = parseFloat(String(r.awayRunLineOdds ?? 'NaN'));
    const homeRLO = parseFloat(String(r.homeRunLineOdds ?? 'NaN'));

    console.log('── CONSISTENCY CHECKS ──');

    // Check 1: ML direction vs RL direction
    if (!isNaN(awayML) && !isNaN(awayBS)) {
      const mlAwayFav = awayML < 0;
      const rlAwayFav = awayBS < 0;
      if (mlAwayFav === rlAwayFav) {
        console.log(`[VERIFY] PASS — ML direction matches RL direction (awayML=${awayML}, awayBS=${awayBS})`);
      } else {
        console.error(`[VERIFY] FAIL — ML direction CONTRADICTS RL direction (awayML=${awayML}, awayBS=${awayBS})`);
      }
    }

    // Check 2: RL favorite should have MORE negative odds than ML favorite
    // i.e. |RL odds for fav| > |ML odds for fav| (harder to cover -1.5 than to just win)
    // Equivalently: RL dog should have MORE positive odds than ML dog
    if (!isNaN(awayML) && !isNaN(homeML) && !isNaN(awaySO) && !isNaN(homeSO)) {
      const mlFavOdds = awayML < 0 ? awayML : homeML;
      const mlDogOdds = awayML > 0 ? awayML : homeML;
      const rlFavOdds = awayBS < 0 ? awaySO : homeSO;
      const rlDogOdds = awayBS > 0 ? awaySO : homeSO;

      console.log(`[STATE] ML fav odds=${mlFavOdds}  ML dog odds=${mlDogOdds}`);
      console.log(`[STATE] RL fav odds (awaySpreadOdds/homeSpreadOdds)=${rlFavOdds}  RL dog odds=${rlDogOdds}`);

      // RL fav must be more negative than ML fav (harder to cover -1.5)
      if (rlFavOdds < mlFavOdds) {
        console.log(`[VERIFY] PASS — RL fav odds (${rlFavOdds}) more negative than ML fav odds (${mlFavOdds})`);
      } else {
        console.error(`[VERIFY] FAIL — RL fav odds (${rlFavOdds}) should be MORE negative than ML fav odds (${mlFavOdds}). INVERSION DETECTED.`);
      }

      // RL dog must be more positive than ML dog (easier to cover +1.5)
      if (rlDogOdds > mlDogOdds) {
        console.log(`[VERIFY] PASS — RL dog odds (${rlDogOdds}) more positive than ML dog odds (${mlDogOdds})`);
      } else {
        console.error(`[VERIFY] FAIL — RL dog odds (${rlDogOdds}) should be MORE positive than ML dog odds (${mlDogOdds}). INVERSION DETECTED.`);
      }
    }

    // Check 3: awaySpreadOdds vs awayRunLineOdds — should be same value
    if (!isNaN(awaySO) && !isNaN(awayRLO)) {
      if (awaySO === awayRLO) {
        console.log(`[VERIFY] PASS — awaySpreadOdds (${awaySO}) matches awayRunLineOdds (${awayRLO})`);
      } else {
        console.error(`[VERIFY] FAIL — awaySpreadOdds (${awaySO}) DOES NOT MATCH awayRunLineOdds (${awayRLO}). COLUMN MISMATCH.`);
      }
    }

    // Check 4: Are the RL odds swapped between away and home?
    if (!isNaN(awaySO) && !isNaN(homeSO) && !isNaN(awayML)) {
      const mlAwayFav = awayML < 0;
      const rlAwayFavByOdds = awaySO < homeSO; // fav has more negative (lower) odds
      if (mlAwayFav === rlAwayFavByOdds) {
        console.log(`[VERIFY] PASS — RL odds assignment consistent with ML direction`);
      } else {
        console.error(`[VERIFY] FAIL — RL odds appear SWAPPED. awaySpreadOdds=${awaySO} homeSpreadOdds=${homeSO} but awayML=${awayML} says away is ${mlAwayFav ? 'FAV' : 'DOG'}`);
      }
    }
  }

  // ── Step 2: Broad audit — find ALL MLB games where RL odds are inverted ────
  console.log('\n=== BROAD AUDIT: All MLB games with RL odds inversion ===');
  const allMlb = await db.select({
    id: games.id,
    gameDate: games.gameDate,
    awayTeam: games.awayTeam,
    homeTeam: games.homeTeam,
    awayML: games.awayML,
    homeML: games.homeML,
    awayBookSpread: games.awayBookSpread,
    awaySpreadOdds: games.awaySpreadOdds,
    homeSpreadOdds: games.homeSpreadOdds,
  }).from(games)
    .where(
      and(
        eq(games.sport, 'MLB'),
      )
    );

  let inverted = 0;
  for (const r of allMlb) {
    const awayML = parseFloat(String(r.awayML ?? 'NaN'));
    const awayBS = parseFloat(String(r.awayBookSpread ?? 'NaN'));
    const awaySO = parseFloat(String(r.awaySpreadOdds ?? 'NaN'));
    const homeSO = parseFloat(String(r.homeSpreadOdds ?? 'NaN'));
    if (isNaN(awayML) || isNaN(awayBS) || isNaN(awaySO) || isNaN(homeSO)) continue;

    // The ML fav should also be the RL fav (negative odds)
    // RL fav odds should be more negative than ML fav odds
    const mlAwayFav = awayML < 0;
    const rlAwayFavByOdds = awaySO < homeSO;

    if (mlAwayFav !== rlAwayFavByOdds) {
      inverted++;
      if (inverted <= 10) {
        console.error(`[VERIFY] INVERTED id=${r.id} ${r.gameDate} ${r.awayTeam}@${r.homeTeam}: awayML=${awayML} awayBS=${awayBS} awaySO=${awaySO} homeSO=${homeSO}`);
      }
    }
  }
  console.log(`[OUTPUT] Total MLB games with RL odds inversion: ${inverted} / ${allMlb.length}`);

  await conn.end();
  console.log('[VERIFY] Audit complete.');
}

main().catch(e => { console.error('[ERROR]', e.message); process.exit(1); });
