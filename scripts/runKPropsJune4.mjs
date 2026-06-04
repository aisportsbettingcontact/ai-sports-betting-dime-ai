// June 4, 2026 K-Props Pipeline Script
import { upsertKPropsForDate } from '../server/kPropsDbHelpers.ts';
import { modelKPropsForDate } from '../server/mlbKPropsModelService.ts';
import * as dotenv from 'dotenv';
dotenv.config();

const TARGET_DATE = '2026-06-04';
const AN_DATE_STR = '20260604';

async function main() {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`[INPUT] K-Props Pipeline — ${TARGET_DATE}`);
  console.log(`${'='.repeat(70)}\n`);

  // Step 1: Scrape AN K-prop lines
  console.log(`[STEP 1] Fetching K-prop book lines from Action Network (${AN_DATE_STR})...`);
  try {
    const anResult = await upsertKPropsForDate(AN_DATE_STR);
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
  console.log(`[VERIFY] ${result.errors === 0 ? 'PASS' : 'FAIL'} — K-props pipeline complete`);
}

main().catch(e => {
  console.error('[ERROR]', e.message);
  process.exit(1);
});
