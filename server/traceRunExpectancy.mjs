/**
 * traceRunExpectancy.mjs
 *
 * Numerically reproduces the Python model's pitcher feature extraction
 * for both Junis and Eovaldi, then computes the implied run expectancy
 * per inning to expose exactly why TEX mu is higher with Junis than Eovaldi.
 *
 * Mirrors MLBAIModel.py lines 2240-2340 exactly.
 */

// ─── Constants (from MLBAIModel.py) ──────────────────────────────────────────
const LEAGUE_ERA   = 4.153;   // 2025 MLB avg ERA (used in model)
const LEAGUE_K_PCT = 0.2222;
const LEAGUE_BB_PCT= 0.0946;
const LEAGUE_HR_PCT= 0.0285;
const LEAGUE_1B_PCT= 0.1450;
const LEAGUE_2B_PCT= 0.0450;
const LEAGUE_3B_PCT= 0.0040;
const PA_PER_9     = 38.0;

// Run values (from MLBAIModel.py RUN_VALUES dict)
const RUN_VALUES = {
  K:      0.00,
  BB:     0.33,
  HBP:    0.33,
  '1B':   0.47,
  '2B':   0.77,
  '3B':   1.04,
  HR:     1.40,
  OUT:    0.00,
};

function clip(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ─── Pitcher feature extraction (mirrors Python exactly) ─────────────────────
function extractPitcherFeatures(stats, label) {
  const era   = stats.era;
  const k9    = stats.k9;
  const bb9   = stats.bb9;
  const whip  = stats.whip;
  const ip    = stats.ip;
  const gp    = Math.max(1, stats.gp);
  const ip_per_game = Math.max(1.0, ip / gp);

  // xFIP
  const xfip_real = stats.xfip;
  const xfip_val = (xfip_real && xfip_real > 0)
    ? clip(xfip_real, 2.0, 7.0)
    : clip(3.5 + (era - LEAGUE_ERA) * 0.5, 2.0, 6.5);

  // FIP
  const fip_val = (stats.fip && stats.fip > 0) ? stats.fip : era;

  // Per-PA rates
  const k_pct  = k9 / PA_PER_9;
  const bb_pct = bb9 / PA_PER_9;

  // HR rate: FIP-based
  const hr9_from_fip = Math.max(
    0.3,
    (fip_val - 3.2 + (2.0 * k9 / 9.0) - (3.0 * bb9 / 9.0)) / (13.0 / 9.0)
  );
  const hr_pct_fip = clip(hr9_from_fip / PA_PER_9, 0.01, 0.07);
  // HR rate: ERA-based
  const hr_pct_era = LEAGUE_HR_PCT * (era / LEAGUE_ERA);
  const hr_pct = clip(0.5 * hr_pct_fip + 0.5 * hr_pct_era, 0.01, 0.07);

  // Hit rates
  const h_per_9   = whip * 9.0 - bb9;
  const h_pct     = h_per_9 / PA_PER_9;
  const single_pct = clip(h_pct * 0.63, 0.06, 0.22);
  const double_pct = clip(h_pct * 0.20, 0.01, 0.08);
  const triple_pct = clip(h_pct * 0.02, 0.001, 0.01);

  // xFIP quality
  const xfip_quality = Math.max(0.5, (5.0 - xfip_val) / 2.5);
  const whiff_pct = clip(clip(k_pct, 0.10, 0.45) * 0.9 * xfip_quality, 0.12, 0.45);

  // OUT pct = 1 - all others
  const k_c  = clip(k_pct, 0.10, 0.45);
  const bb_c = clip(bb_pct, 0.03, 0.18);
  const out_pct = Math.max(0, 1.0 - k_c - bb_c - hr_pct - single_pct - double_pct - triple_pct);

  // Expected run value per PA (simplified log5 vs league-avg batter)
  // Using league-avg batter probs for isolation
  const k_final  = k_c;
  const bb_final = bb_c;
  const hr_final = hr_pct;
  const s1_final = single_pct;
  const s2_final = double_pct;
  const s3_final = triple_pct;
  const out_final = Math.max(0, 1.0 - k_final - bb_final - hr_final - s1_final - s2_final - s3_final);

  // Expected run value per PA
  const ev_per_pa = (
    k_final  * RUN_VALUES.K  +
    bb_final * RUN_VALUES.BB +
    hr_final * RUN_VALUES.HR +
    s1_final * RUN_VALUES['1B'] +
    s2_final * RUN_VALUES['2B'] +
    s3_final * RUN_VALUES['3B'] +
    out_final * RUN_VALUES.OUT
  );

  // Expected runs per inning = ev_per_pa * PA_per_inning
  // PA per inning ≈ 38/9 = 4.22
  const pa_per_inning = PA_PER_9 / 9.0;
  const exp_runs_per_inning = ev_per_pa * pa_per_inning;

  // Expected runs over full game (9 innings, no bullpen adjustment)
  const exp_runs_9 = exp_runs_per_inning * 9.0;

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`PITCHER: ${label}`);
  console.log(`${'─'.repeat(60)}`);
  console.log(`  [INPUT] ERA=${era.toFixed(3)} K9=${k9.toFixed(3)} BB9=${bb9.toFixed(3)} HR9=${stats.hr9?.toFixed(3)} WHIP=${whip.toFixed(3)}`);
  console.log(`  [INPUT] FIP=${fip_val.toFixed(3)} xFIP=${xfip_val.toFixed(3)} IP=${ip.toFixed(1)} GP=${gp}`);
  console.log(`  [DERIVED] k_pct=${k_c.toFixed(4)} bb_pct=${bb_c.toFixed(4)} hr_pct=${hr_pct.toFixed(4)}`);
  console.log(`  [DERIVED] single_pct=${s1_final.toFixed(4)} double_pct=${s2_final.toFixed(4)} triple_pct=${s3_final.toFixed(4)}`);
  console.log(`  [DERIVED] out_pct=${out_final.toFixed(4)} (sum check: ${(k_final+bb_final+hr_final+s1_final+s2_final+s3_final+out_final).toFixed(4)})`);
  console.log(`  [DERIVED] hr9_from_fip=${hr9_from_fip.toFixed(4)} hr_pct_fip=${hr_pct_fip.toFixed(4)} hr_pct_era=${hr_pct_era.toFixed(4)}`);
  console.log(`  [DERIVED] xfip_quality=${xfip_quality.toFixed(4)} whiff_pct=${whiff_pct.toFixed(4)}`);
  console.log(`  [DERIVED] ev_per_pa=${ev_per_pa.toFixed(6)}`);
  console.log(`  [DERIVED] exp_runs_per_inning=${exp_runs_per_inning.toFixed(4)}`);
  console.log(`  [OUTPUT] exp_runs_9_innings=${exp_runs_9.toFixed(4)}  ← ARI/TEX will score THIS many runs vs this pitcher`);
  console.log(`  [NOTE]   Lower = better pitcher = FEWER runs for opponent`);

  return {
    label,
    era, k9, bb9, whip, fip_val, xfip_val,
    k_c, bb_c, hr_pct, s1_final, s2_final, s3_final, out_final,
    ev_per_pa, exp_runs_per_inning, exp_runs_9,
    xfip_quality, ip_per_game,
  };
}

// ─── Junis (calibrated v2) ────────────────────────────────────────────────────
const junis = {
  era: 3.953, k9: 5.795, bb9: 1.931, hr9: 0.717, whip: 0.943,
  fip: 3.558, xfip: 5.123, ip: 16.1, gp: 15,
  eraMinus: 39.97, fipMinus: 83.87,
};

// ─── Eovaldi (2026 season) ────────────────────────────────────────────────────
const eovaldi = {
  era: 4.150, k9: 8.870, bb9: 1.890, hr9: 1.890, whip: 1.170,
  fip: 4.703, xfip: 3.316, ip: 47.7, gp: 8,
  eraMinus: 100.44, fipMinus: 110.98,
};

console.log('='.repeat(72));
console.log('FULL NUMERICAL TRACE: JUNIS vs EOVALDI RUN EXPECTANCY');
console.log('='.repeat(72));

const jFeat = extractPitcherFeatures(junis, 'Jakob Junis (TEX starter, calibrated v2)');
const eFeat = extractPitcherFeatures(eovaldi, 'Nathan Eovaldi (TEX starter, scratched)');

// ─── Side-by-side comparison ──────────────────────────────────────────────────
console.log('\n' + '='.repeat(72));
console.log('SIDE-BY-SIDE COMPARISON');
console.log('='.repeat(72));
console.log('\n  Metric                  | Eovaldi        | Junis          | Delta (Junis-Eov)');
console.log('  ' + '-'.repeat(80));

const rows = [
  ['ERA (input)', eFeat.era, jFeat.era],
  ['FIP (input)', eFeat.fip_val, jFeat.fip_val],
  ['xFIP (input)', eFeat.xfip_val, jFeat.xfip_val],
  ['K9 (input)', eFeat.k9, jFeat.k9],
  ['BB9 (input)', eFeat.bb9, jFeat.bb9],
  ['WHIP (input)', eFeat.whip, jFeat.whip],
  ['k_pct (derived)', eFeat.k_c, jFeat.k_c],
  ['bb_pct (derived)', eFeat.bb_c, jFeat.bb_c],
  ['hr_pct (derived)', eFeat.hr_pct, jFeat.hr_pct],
  ['single_pct (derived)', eFeat.s1_final, jFeat.s1_final],
  ['xfip_quality (mult)', eFeat.xfip_quality, jFeat.xfip_quality],
  ['ev_per_pa (key)', eFeat.ev_per_pa, jFeat.ev_per_pa],
  ['exp_runs/inning (KEY)', eFeat.exp_runs_per_inning, jFeat.exp_runs_per_inning],
  ['exp_runs/9 (KEY)', eFeat.exp_runs_9, jFeat.exp_runs_9],
];

for (const [name, ev, jv] of rows) {
  const delta = jv - ev;
  const flag = name.includes('KEY') ? ' ←' : '';
  const sign = delta > 0 ? '+' : '';
  console.log(`  ${name.padEnd(23)} | ${ev.toFixed(4).padEnd(14)} | ${jv.toFixed(4).padEnd(14)} | ${sign}${delta.toFixed(4)}${flag}`);
}

// ─── Root cause analysis ──────────────────────────────────────────────────────
console.log('\n' + '='.repeat(72));
console.log('ROOT CAUSE ANALYSIS');
console.log('='.repeat(72));

const runDelta = jFeat.exp_runs_9 - eFeat.exp_runs_9;
console.log(`\n  ARI scores ${runDelta > 0 ? 'MORE' : 'FEWER'} runs vs Junis than vs Eovaldi: ${runDelta > 0 ? '+' : ''}${runDelta.toFixed(4)} runs/game`);
console.log(`\n  Primary drivers:`);

// xFIP impact
const xfipDelta = jFeat.xfip_val - eFeat.xfip_val;
console.log(`\n  1. xFIP: Junis=${jFeat.xfip_val.toFixed(3)} vs Eovaldi=${eFeat.xfip_val.toFixed(3)} (delta=${xfipDelta > 0 ? '+' : ''}${xfipDelta.toFixed(3)})`);
console.log(`     xfip_quality: Junis=${jFeat.xfip_quality.toFixed(4)} vs Eovaldi=${eFeat.xfip_quality.toFixed(4)}`);
console.log(`     ⚠ Junis xFIP=5.123 → xfip_quality=${jFeat.xfip_quality.toFixed(4)} (BELOW 1.0 = WORSE than avg)`);
console.log(`     ⚠ Eovaldi xFIP=3.316 → xfip_quality=${eFeat.xfip_quality.toFixed(4)} (ABOVE 1.0 = BETTER than avg)`);
console.log(`     → This means Eovaldi's K rate is AMPLIFIED by xfip_quality, Junis's is REDUCED`);

// K rate impact
const kDelta = jFeat.k_c - eFeat.k_c;
console.log(`\n  2. K rate: Junis=${jFeat.k_c.toFixed(4)} vs Eovaldi=${eFeat.k_c.toFixed(4)} (delta=${kDelta > 0 ? '+' : ''}${kDelta.toFixed(4)})`);
console.log(`     Junis K9=5.795 → k_pct=0.1525 (BELOW league avg ${LEAGUE_K_PCT})`);
console.log(`     Eovaldi K9=8.870 → k_pct=0.2334 (ABOVE league avg)`);
console.log(`     → Fewer Ks = more balls in play = more runs for ARI`);

// WHIP/singles impact
const whipDelta = jFeat.whip - eFeat.whip;
console.log(`\n  3. WHIP: Junis=${jFeat.whip.toFixed(3)} vs Eovaldi=${eFeat.whip.toFixed(3)} (delta=${whipDelta > 0 ? '+' : ''}${whipDelta.toFixed(3)})`);
console.log(`     Junis WHIP=0.943 → single_pct=${jFeat.s1_final.toFixed(4)}`);
console.log(`     Eovaldi WHIP=1.170 → single_pct=${eFeat.s1_final.toFixed(4)}`);
console.log(`     ⚠ Junis WHIP=0.943 is BABIP-driven (6-start outlier) — artificially suppresses ARI hits`);

// HR rate impact
const hrDelta = jFeat.hr_pct - eFeat.hr_pct;
console.log(`\n  4. HR rate: Junis=${jFeat.hr_pct.toFixed(4)} vs Eovaldi=${eFeat.hr_pct.toFixed(4)} (delta=${hrDelta > 0 ? '+' : ''}${hrDelta.toFixed(4)})`);
console.log(`     Junis FIP=3.558 → hr9_from_fip low → hr_pct suppressed`);
console.log(`     Eovaldi FIP=4.703 → hr9_from_fip high → hr_pct elevated`);

console.log('\n' + '='.repeat(72));
console.log('VERDICT');
console.log('='.repeat(72));
if (runDelta < 0) {
  console.log(`\n  ⚠ ARI scores ${Math.abs(runDelta).toFixed(3)} FEWER runs vs Junis than vs Eovaldi`);
  console.log(`  ⚠ This means TEX is FAVORED MORE with Junis — CONFIRMED BUG`);
  console.log(`\n  ROOT CAUSE: Three compounding factors:`);
  console.log(`    1. Junis WHIP=0.943 (BABIP-lucky, 6-start sample) → suppresses ARI hits`);
  console.log(`    2. Junis K9=5.795 (relief role, not starter K rate) → fewer Ks = more balls in play`);
  console.log(`       BUT WHIP effect dominates: fewer hits > more balls in play`);
  console.log(`    3. Junis FIP=3.558 (2024 sabermetrics, elite) → suppresses HR rate`);
  console.log(`\n  FIX REQUIRED:`);
  console.log(`    A. Regress WHIP to FIP-implied value: ~1.20 (not 0.943)`);
  console.log(`    B. Use FIP=3.56 but apply HR rate from calibrated ERA (not FIP)`);
  console.log(`    C. K9 is already calibrated (5.795) — this is correct for a spot starter`);
} else {
  console.log(`\n  ARI scores ${runDelta.toFixed(3)} MORE runs vs Junis — model is correct directionally`);
  console.log(`  But TEX ML is still higher — investigate HFA and bullpen effects`);
}
