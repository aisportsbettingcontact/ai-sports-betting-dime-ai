/**
 * auditJunisVsEovaldi.mjs
 * Full side-by-side audit of every DB input for Junis vs Eovaldi.
 * Goal: identify exactly why TEX is favored MORE with Junis than Eovaldi.
 */
import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config({ quiet: true });

const db = await mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 2 });

const JUNIS_ID = 596001;    // Jakob Junis
const EOVALDI_ID = 543135;  // Nathan Eovaldi

console.log('='.repeat(80));
console.log('DEEP AUDIT: JUNIS vs EOVALDI — ALL MODEL INPUTS');
console.log('='.repeat(80));

// ─── 1. mlb_pitcher_stats ────────────────────────────────────────────────────
console.log('\n[TABLE 1] mlb_pitcher_stats');
const [ps] = await db.execute(
  'SELECT mlbamId, fullName, teamAbbrev, era, k9, bb9, hr9, whip, ip, gamesStarted, gamesPlayed, fip, xfip, fipMinus, eraMinus, war, throwsHand, nrfiRate, nrfiStarts, f5RunsAllowedMean, fgRunsAllowedMean, ipMean3yr FROM mlb_pitcher_stats WHERE mlbamId IN (?,?) ORDER BY fullName',
  [JUNIS_ID, EOVALDI_ID]
);
for (const p of ps) {
  console.log(`\n  [${p.fullName}] mlbamId=${p.mlbamId}`);
  console.log(`    ERA:          ${p.era?.toFixed(3) ?? 'NULL'}`);
  console.log(`    FIP:          ${p.fip?.toFixed(3) ?? 'NULL'}`);
  console.log(`    xFIP:         ${p.xfip?.toFixed(3) ?? 'NULL'}`);
  console.log(`    FIP-:         ${p.fipMinus?.toFixed(2) ?? 'NULL'}  (100=avg, lower=better)`);
  console.log(`    ERA-:         ${p.eraMinus?.toFixed(2) ?? 'NULL'}  (100=avg, lower=better) ← KEY FLAG`);
  console.log(`    K9:           ${p.k9?.toFixed(3) ?? 'NULL'}`);
  console.log(`    BB9:          ${p.bb9?.toFixed(3) ?? 'NULL'}`);
  console.log(`    HR9:          ${p.hr9?.toFixed(3) ?? 'NULL'}`);
  console.log(`    WHIP:         ${p.whip?.toFixed(3) ?? 'NULL'}`);
  console.log(`    IP:           ${p.ip?.toFixed(1) ?? 'NULL'}`);
  console.log(`    GS:           ${p.gamesStarted ?? 'NULL'}`);
  console.log(`    GP:           ${p.gamesPlayed ?? 'NULL'}`);
  console.log(`    WAR:          ${p.war?.toFixed(3) ?? 'NULL'}`);
  console.log(`    nrfiRate:     ${p.nrfiRate?.toFixed(4) ?? 'NULL'}`);
  console.log(`    nrfiStarts:   ${p.nrfiStarts ?? 'NULL'}`);
  console.log(`    f5RunsAllowed: ${p.f5RunsAllowedMean?.toFixed(4) ?? 'NULL'}`);
  console.log(`    fgRunsAllowed: ${p.fgRunsAllowedMean?.toFixed(4) ?? 'NULL'}`);
  console.log(`    ipMean3yr:    ${p.ipMean3yr?.toFixed(4) ?? 'NULL'}`);
  console.log(`    throwsHand:   ${p.throwsHand ?? 'NULL'}`);
}

// ─── 2. mlb_pitcher_rolling5 ────────────────────────────────────────────────
console.log('\n[TABLE 2] mlb_pitcher_rolling5');
const [r5] = await db.execute(
  'SELECT mlbamId, fullName, startsIncluded, ip5, era5, k9_5, bb9_5, hr9_5, whip5, fip5, lastStartDate FROM mlb_pitcher_rolling5 WHERE mlbamId IN (?,?) ORDER BY fullName',
  [JUNIS_ID, EOVALDI_ID]
);
for (const p of r5) {
  console.log(`\n  [${p.fullName}] mlbamId=${p.mlbamId}`);
  console.log(`    startsIncluded: ${p.startsIncluded}`);
  console.log(`    ip5:            ${p.ip5?.toFixed(2) ?? 'NULL'}`);
  console.log(`    era5:           ${p.era5?.toFixed(3) ?? 'NULL'}`);
  console.log(`    k9_5:           ${p.k9_5?.toFixed(3) ?? 'NULL'}`);
  console.log(`    bb9_5:          ${p.bb9_5?.toFixed(3) ?? 'NULL'}`);
  console.log(`    hr9_5:          ${p.hr9_5?.toFixed(3) ?? 'NULL'}`);
  console.log(`    whip5:          ${p.whip5?.toFixed(3) ?? 'NULL'}`);
  console.log(`    fip5:           ${p.fip5?.toFixed(3) ?? 'NULL'}`);
  console.log(`    lastStartDate:  ${p.lastStartDate ?? 'NULL'}`);
}

// ─── 3. mlb_pitcher_sabermetrics ─────────────────────────────────────────────
console.log('\n[TABLE 3] mlb_pitcher_sabermetrics');
const [sab] = await db.execute(
  'SELECT mlbamId, fullName, season, eraMinus, fipMinus, xfipMinus, war, kPct, bbPct, hrPct, babip, lobPct, gbPct, fbPct, swstrPct, cstrPct, ip, gs FROM mlb_pitcher_sabermetrics WHERE mlbamId IN (?,?) ORDER BY fullName, season DESC',
  [JUNIS_ID, EOVALDI_ID]
);
for (const p of sab) {
  console.log(`\n  [${p.fullName}] season=${p.season} mlbamId=${p.mlbamId}`);
  console.log(`    ERA-:    ${p.eraMinus?.toFixed(2) ?? 'NULL'}  ← THIS IS THE FLAG (Junis=40.0 = elite)`);
  console.log(`    FIP-:    ${p.fipMinus?.toFixed(2) ?? 'NULL'}`);
  console.log(`    xFIP-:   ${p.xfipMinus?.toFixed(2) ?? 'NULL'}`);
  console.log(`    WAR:     ${p.war?.toFixed(3) ?? 'NULL'}`);
  console.log(`    K%:      ${p.kPct?.toFixed(4) ?? 'NULL'}`);
  console.log(`    BB%:     ${p.bbPct?.toFixed(4) ?? 'NULL'}`);
  console.log(`    HR%:     ${p.hrPct?.toFixed(4) ?? 'NULL'}`);
  console.log(`    BABIP:   ${p.babip?.toFixed(4) ?? 'NULL'}`);
  console.log(`    LOB%:    ${p.lobPct?.toFixed(4) ?? 'NULL'}`);
  console.log(`    GB%:     ${p.gbPct?.toFixed(4) ?? 'NULL'}`);
  console.log(`    SwStr%:  ${p.swstrPct?.toFixed(4) ?? 'NULL'}`);
  console.log(`    IP:      ${p.ip?.toFixed(1) ?? 'NULL'}`);
  console.log(`    GS:      ${p.gs ?? 'NULL'}`);
}

// ─── 4. Compute what the model would derive for k_pct, bb_pct, hr_pct ────────
console.log('\n[DERIVED] Model k_pct / bb_pct / hr_pct derivation');
console.log('  The model uses these to build the per-PA probability distribution.');
console.log('  k_pct = K9 / (9 * PA_per_IP)  where PA_per_IP ≈ 4.3');
const PA_PER_IP = 4.3;
for (const p of ps) {
  const k_pct = p.k9 ? p.k9 / (9 * PA_PER_IP) : null;
  const bb_pct = p.bb9 ? p.bb9 / (9 * PA_PER_IP) : null;
  const hr_pct = p.hr9 ? p.hr9 / (9 * PA_PER_IP) : null;
  console.log(`\n  [${p.fullName}]`);
  console.log(`    k_pct  = ${k9_to_kpct(p.k9)?.toFixed(4) ?? 'NULL'}  (from K9=${p.k9?.toFixed(2)})`);
  console.log(`    bb_pct = ${k9_to_kpct(p.bb9)?.toFixed(4) ?? 'NULL'}  (from BB9=${p.bb9?.toFixed(2)})`);
  console.log(`    hr_pct = ${k9_to_kpct(p.hr9)?.toFixed(4) ?? 'NULL'}  (from HR9=${p.hr9?.toFixed(2)})`);
  // Expected runs per 9 from these rates (simplified)
  const exp_runs = p.era ?? null;
  console.log(`    ERA (model input): ${exp_runs?.toFixed(3) ?? 'NULL'}`);
  console.log(`    eraMinus (model input): ${p.eraMinus?.toFixed(2) ?? 'NULL'} → ${eraMinus_to_era(p.eraMinus)?.toFixed(2) ?? 'NULL'} implied ERA`);
}

function k9_to_kpct(k9) { return k9 ? k9 / (9 * PA_PER_IP) : null; }
function eraMinus_to_era(eraMinus) {
  // ERA- = (pitcher ERA / league avg ERA) * 100
  // League avg ERA 2026 ≈ 4.35
  return eraMinus ? (eraMinus / 100) * 4.35 : null;
}

// ─── 5. Check how eraMinus is used in the Python model ───────────────────────
console.log('\n[CRITICAL] eraMinus impact analysis:');
console.log('  League avg ERA 2026 = 4.35');
for (const p of ps) {
  const implied_era = eraMinus_to_era(p.eraMinus);
  const actual_era = p.era;
  console.log(`\n  [${p.fullName}]`);
  console.log(`    eraMinus=${p.eraMinus?.toFixed(2)} → implied ERA=${implied_era?.toFixed(2)}`);
  console.log(`    Actual ERA in DB: ${actual_era?.toFixed(2)}`);
  console.log(`    DISCREPANCY: ${actual_era && implied_era ? (actual_era - implied_era).toFixed(2) : 'N/A'} runs`);
  if (p.eraMinus && p.eraMinus < 60) {
    console.log(`    ⚠ ALERT: eraMinus=${p.eraMinus?.toFixed(2)} is ELITE (< 60) — this will SUPPRESS opponent run scoring`);
    console.log(`    ⚠ This means ARI will score FEWER runs against Junis in the model`);
    console.log(`    ⚠ But Junis ERA=3.95 implies eraMinus should be ~${(3.95/4.35*100).toFixed(1)}`);
  }
}

// ─── 6. Check the game record for ARI@TEX ────────────────────────────────────
console.log('\n[TABLE 4] games record for ARI@TEX May 11');
const [game] = await db.execute(
  "SELECT id, awayTeam, homeTeam, homeStartingPitcher, awayStartingPitcher, modelHomeScore, modelAwayScore, modelTotal, modelHomeWinPct, modelSpread FROM games WHERE gameDate='2026-05-11' AND awayTeam='ARI' AND homeTeam='TEX'",
);
console.log('  Game:', JSON.stringify(game[0], null, 2));

// ─── 7. Check what Eovaldi's inputs were ─────────────────────────────────────
console.log('\n[COMPARISON] Eovaldi vs Junis — key model inputs:');
const eov = ps.find(p => p.mlbamId === EOVALDI_ID);
const jun = ps.find(p => p.mlbamId === JUNIS_ID);
if (eov && jun) {
  const fields = ['era', 'fip', 'xfip', 'eraMinus', 'fipMinus', 'k9', 'bb9', 'hr9', 'whip', 'ipMean3yr'];
  console.log('\n  Field           | Eovaldi        | Junis          | Delta (Junis-Eov)');
  console.log('  ' + '-'.repeat(75));
  for (const f of fields) {
    const ev = eov[f];
    const jv = jun[f];
    const delta = (ev != null && jv != null) ? (jv - ev).toFixed(3) : 'N/A';
    const flag = f === 'eraMinus' && jv < 60 ? ' ← ⚠ ELITE FLAG' : '';
    console.log(`  ${f.padEnd(15)} | ${String(ev?.toFixed(3) ?? 'NULL').padEnd(14)} | ${String(jv?.toFixed(3) ?? 'NULL').padEnd(14)} | ${delta}${flag}`);
  }
}

console.log('\n' + '='.repeat(80));
console.log('AUDIT COMPLETE');
console.log('='.repeat(80));

await db.end();
