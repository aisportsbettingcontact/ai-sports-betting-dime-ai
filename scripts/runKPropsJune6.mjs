// June 6, 2026 K-Props Pipeline Script
import { upsertKPropsForDate } from '../server/kPropsDbHelpers.ts';
import { modelKPropsForDate } from '../server/mlbKPropsModelService.ts';
import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config();

const TARGET_DATE = '2026-06-06';
const AN_DATE_STR = '20260606';

async function main() {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`[INPUT] K-Props Pipeline — ${TARGET_DATE}`);
  console.log(`${'='.repeat(70)}\n`);

  // Step 1: Scrape AN K-prop lines
  console.log(`[STEP 1] Fetching K-prop book lines from Action Network (${AN_DATE_STR})...`);
  let anResult;
  try {
    anResult = await upsertKPropsForDate(AN_DATE_STR);
    console.log(`[OUTPUT] AN scrape: inserted=${anResult.inserted} updated=${anResult.updated} skipped=${anResult.skipped} errors=${anResult.errors}`);
    if (anResult.inserted + anResult.updated === 0) {
      console.log(`[WARN] No K-prop lines available from AN yet for ${TARGET_DATE} — markets may not be posted`);
      console.log(`[STATE] K-props will auto-populate when AN posts lines closer to game time`);
      return;
    }
  } catch (e) {
    console.log(`[WARN] AN scrape failed: ${e.message}`);
    console.log(`[STATE] K-props will auto-populate when AN posts lines closer to game time`);
    return;
  }

  // Step 2: Run StrikeoutModel
  console.log(`\n[STEP 2] Running StrikeoutModel for ${TARGET_DATE}...`);
  const result = await modelKPropsForDate(TARGET_DATE);
  console.log(`[OUTPUT] modeled=${result.modeled} skipped=${result.skipped} errors=${result.errors}`);

  // Step 3: Post-run validation
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  const [props] = await conn.execute(`
    SELECT kp.id, kp.pitcherName, kp.teamAbbr, kp.bookLine, kp.bookOverOdds,
           kp.modelLine, kp.modelOverOdds, kp.modelUnderOdds,
           kp.modelKPct, kp.edgeDirection, kp.edgeMagnitude
    FROM mlb_k_props kp
    JOIN games g ON g.id = kp.gameId
    WHERE g.gameDate = '${TARGET_DATE}'
    ORDER BY kp.id ASC
  `);
  await conn.end();

  console.log(`\n[VERIFY] K-Props post-run: ${props.length} props`);
  props.forEach(p => {
    const ok = p.modelLine != null && p.modelOverOdds != null;
    const s = ok ? '✓' : '✗';
    console.log(`  [${s}] ${p.pitcherName} (${p.teamAbbr}) bookLine=${p.bookLine} modelLine=${p.modelLine} modelOdds=${p.modelOverOdds}/${p.modelUnderOdds} edge=${p.edgeDirection||'NO EDGE'}(${p.edgeMagnitude||0}%)`);
  });

  console.log(`[VERIFY] ${result.errors === 0 ? 'PASS' : 'FAIL'} — K-props pipeline complete`);
}

main().catch(e => {
  console.error('[ERROR]', e.message);
  process.exit(1);
});
