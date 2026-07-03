/**
 * investigateFrozenFallback.mjs
 * PURPOSE: Investigate whether the wc2026_frozen_book_odds fallback in the router
 *          has ever been needed / would be needed if removed.
 * NO WRITES — READ ONLY INVESTIGATION
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const FROZEN_IDS = [
  'wc26-g-055','wc26-g-056','wc26-g-057','wc26-g-058','wc26-g-059',
  'wc26-g-060','wc26-g-061','wc26-g-062','wc26-g-063','wc26-g-064',
  'wc26-g-065','wc26-g-066','wc26-g-067','wc26-g-068','wc26-g-069',
  'wc26-g-070','wc26-g-071','wc26-g-072',
  'wc26-r16-089','wc26-r16-090','wc26-r16-091',
  'wc26-r32-073','wc26-r32-074','wc26-r32-075','wc26-r32-076',
  'wc26-r32-077','wc26-r32-078','wc26-r32-079','wc26-r32-080',
  'wc26-r32-081','wc26-r32-082','wc26-r32-083','wc26-r32-084',
  'wc26-r32-085','wc26-r32-086','wc26-r32-087','wc26-r32-088',
];

const ph = FROZEN_IDS.map(() => '?').join(',');

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  console.log('[CONNECT] Connected to TiDB');

  // ── 1. Fixture dates and rounds ───────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('SECTION 1: FROZEN FIXTURE DATES AND ROUNDS');
  console.log('══════════════════════════════════════════════════════════');
  const [dates] = await conn.execute(
    'SELECT match_id, match_date, stage FROM wc2026_matches WHERE match_id IN (' + ph + ') ORDER BY match_date',
    FROZEN_IDS
  );
  const dateMap = {};
  dates.forEach(r => {
    dateMap[r.match_id] = r;
    console.log(`  ${r.match_id.padEnd(20)} | ${String(r.match_date).substring(0,10)} | ${r.stage}`);
  });

  // ── 2. wc2026MatchOdds coverage ───────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('SECTION 2: wc2026MatchOdds COVERAGE FOR ALL 37 FROZEN IDs');
  console.log('══════════════════════════════════════════════════════════');
  const [mo] = await conn.execute(
    'SELECT match_id, book_home_ml, book_draw, book_away_ml, book_primary_spread, book_total, book_btts_yes, book_home_to_advance, book_away_to_advance FROM wc2026MatchOdds WHERE match_id IN (' + ph + ') ORDER BY match_id',
    FROZEN_IDS
  );
  const moMap = Object.fromEntries(mo.map(r => [r.match_id, r]));
  const missingInMatch = FROZEN_IDS.filter(id => !moMap[id]);
  console.log(`  wc2026MatchOdds rows found: ${mo.length} / ${FROZEN_IDS.length}`);
  if (missingInMatch.length > 0) {
    console.log(`  ❌ MISSING in wc2026MatchOdds: ${missingInMatch.join(', ')}`);
  } else {
    console.log(`  ✅ ALL 37 frozen match_ids exist in wc2026MatchOdds`);
  }

  // Check which ones have NULL book_home_ml (no odds populated)
  const nullOdds = mo.filter(r => r.book_home_ml === null);
  console.log(`  wc2026MatchOdds rows with NULL book_home_ml: ${nullOdds.length}`);
  nullOdds.forEach(r => console.log(`    ${r.match_id} — no odds in wc2026MatchOdds`));

  const hasOdds = mo.filter(r => r.book_home_ml !== null);
  console.log(`  wc2026MatchOdds rows WITH book odds: ${hasOdds.length}`);

  // ── 3. DK odds_snapshots coverage ─────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('SECTION 3: DK ODDS_SNAPSHOTS (book_id=68) COVERAGE');
  console.log('══════════════════════════════════════════════════════════');
  const [snaps] = await conn.execute(
    'SELECT match_id, COUNT(*) as cnt FROM wc2026_odds_snapshots WHERE book_id = 68 AND match_id IN (' + ph + ') GROUP BY match_id ORDER BY match_id',
    FROZEN_IDS
  );
  const snapMap = Object.fromEntries(snaps.map(r => [r.match_id, r.cnt]));
  const noSnap = FROZEN_IDS.filter(id => !snapMap[id]);
  console.log(`  Fixtures WITH DK snapshots: ${snaps.length} / ${FROZEN_IDS.length}`);
  if (noSnap.length > 0) {
    console.log(`  ❌ NO DK SNAPSHOT for ${noSnap.length} fixtures:`);
    noSnap.forEach(id => console.log(`    ${id} | stage=${dateMap[id] ? dateMap[id].stage : 'unknown'}`));
  } else {
    console.log(`  ✅ ALL 37 frozen fixtures have DK snapshots`);
  }

  // ── 4. The critical question: for fixtures in frozen table, does wc2026MatchOdds
  //       have the SAME odds as frozen? (i.e. is frozen redundant?)
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('SECTION 4: FROZEN vs wc2026MatchOdds — ODDS COMPARISON');
  console.log('══════════════════════════════════════════════════════════');
  const [frozenOdds] = await conn.execute(
    'SELECT match_id, book_home_ml, book_draw, book_away_ml, book_primary_spread, book_total, book_btts_yes, book_home_to_advance, book_away_to_advance FROM wc2026_frozen_book_odds ORDER BY match_id',
    []
  );
  let exactMatch = 0, mismatch = 0, matchHasNoOdds = 0;
  for (const fr of frozenOdds) {
    const mr = moMap[fr.match_id];
    if (!mr) { console.log(`  ❌ ${fr.match_id} — NOT IN wc2026MatchOdds`); continue; }
    if (mr.book_home_ml === null) {
      matchHasNoOdds++;
      console.log(`  ⚠️  ${fr.match_id} — wc2026MatchOdds has NULL odds (frozen has: ${fr.book_home_ml}/${fr.book_draw}/${fr.book_away_ml})`);
      continue;
    }
    const same = (
      mr.book_home_ml == fr.book_home_ml &&
      mr.book_draw == fr.book_draw &&
      mr.book_away_ml == fr.book_away_ml &&
      Math.abs((mr.book_primary_spread || 0) - (fr.book_primary_spread || 0)) < 0.01 &&
      Math.abs((mr.book_total || 0) - (fr.book_total || 0)) < 0.01
    );
    if (same) {
      exactMatch++;
      console.log(`  ✅ ${fr.match_id} — IDENTICAL in both tables (ML=${fr.book_home_ml}/${fr.book_draw}/${fr.book_away_ml})`);
    } else {
      mismatch++;
      console.log(`  ⚠️  ${fr.match_id} — DIFFERS: frozen ML=${fr.book_home_ml}/${fr.book_draw}/${fr.book_away_ml} | match ML=${mr.book_home_ml}/${mr.book_draw}/${mr.book_away_ml}`);
    }
  }
  console.log(`\n  SUMMARY: exactMatch=${exactMatch} | mismatch=${mismatch} | matchHasNoOdds=${matchHasNoOdds}`);

  // ── 5. Router fallback logic analysis ─────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('SECTION 5: ROUTER FALLBACK LOGIC ANALYSIS');
  console.log('══════════════════════════════════════════════════════════');
  console.log('  Router line 245: dkOdds = frozenBook ? frozenBookToOdds(frozenBook) : (dkMap[f.matchId] ?? null)');
  console.log('  frozenBook = frozenBookMap[f.matchId] ?? null');
  console.log('');
  console.log('  LOGIC: If a match_id exists in wc2026_frozen_book_odds → use frozen odds');
  console.log('         If NOT in wc2026_frozen_book_odds → fall back to wc2026_odds_snapshots (DK book_id=68)');
  console.log('');
  console.log('  QUESTION: Has the frozen path ever been the ONLY source of odds?');
  console.log('  (i.e., are there fixtures where frozen has odds but DK snapshot has NONE?)');
  console.log('');

  // Find fixtures where frozen has odds but DK snapshot has zero rows
  let frozenOnlyCount = 0;
  for (const fr of frozenOdds) {
    const hasDkSnap = !!snapMap[fr.match_id];
    const matchHasOdds = moMap[fr.match_id] && moMap[fr.match_id].book_home_ml !== null;
    if (!hasDkSnap) {
      frozenOnlyCount++;
      console.log(`  🔴 ${fr.match_id} — frozen has odds (${fr.book_home_ml}/${fr.book_draw}/${fr.book_away_ml}) but NO DK snapshot exists`);
      console.log(`       wc2026MatchOdds has odds: ${matchHasOdds ? 'YES' : 'NO'}`);
    }
  }
  if (frozenOnlyCount === 0) {
    console.log('  ✅ ZERO fixtures where frozen was the ONLY source — every frozen fixture also has DK snapshots');
  }

  // ── 6. VERDICT ────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('SECTION 6: FINAL VERDICT');
  console.log('══════════════════════════════════════════════════════════');
  console.log(`  Total frozen fixtures: ${FROZEN_IDS.length}`);
  console.log(`  All exist in wc2026MatchOdds: ${missingInMatch.length === 0 ? 'YES' : 'NO — ' + missingInMatch.length + ' missing'}`);
  console.log(`  wc2026MatchOdds has NULL odds for: ${matchHasNoOdds} fixtures`);
  console.log(`  Frozen was ONLY source (no DK snapshot): ${frozenOnlyCount}`);
  console.log(`  Odds identical between frozen and wc2026MatchOdds: ${exactMatch}`);
  console.log(`  Odds differ between frozen and wc2026MatchOdds: ${mismatch}`);

  await conn.end();
  console.log('\n[DONE] Investigation complete — READ ONLY, no writes performed');
}

main().catch(e => { console.error('[FATAL]', e.message); process.exit(1); });
