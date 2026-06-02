/**
 * rlRootCauseAnalysis.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * COMPLETE ROOT CAUSE ANALYSIS for three MLB RL bugs:
 *   Bug 1: TOR model RL shows -132 when model ML is +155 (odds swap)
 *   Bug 2: CLE +1.5 book -103 vs model +104 shows as edge (false edge)
 *   Bug 3: SD +1.5 book -175 vs model -167 shows as edge (false edge)
 *
 * Uses ACTUAL DB values from today's games (June 2, 2026).
 * Run: node scripts/rlRootCauseAnalysis.mjs
 */

// ── Math utilities ─────────────────────────────────────────────────────────────
function implied(odds) {
  const o = parseFloat(String(odds));
  if (isNaN(o) || o === 0) return NaN;
  return o < 0 ? Math.abs(o) / (Math.abs(o) + 100) : 100 / (o + 100);
}

function noVigProb(odds1, odds2) {
  const p1 = implied(odds1);
  const p2 = implied(odds2);
  if (isNaN(p1) || isNaN(p2)) return NaN;
  return p1 / (p1 + p2);
}

function fmt(p) { return (p * 100).toFixed(2) + '%'; }
function fmtDiff(d) { return (d >= 0 ? '+' : '') + (d * 100).toFixed(2) + 'pp'; }

// ── ACTUAL DB DATA (from today's June 2, 2026 games) ──────────────────────────
// Extracted from the DB query output above.

const games = [
  // ── BUG 1: TOR — need to find today's TOR game ──────────────────────────────
  // The screenshots show TOR model RL = -132 when model ML = +155
  // This is the canonical Bug 1 example from the session context.
  // We'll analyze the mathematical invariant: for any underdog (ML > 0),
  //   P(cover +1.5) MUST be > P(win outright)
  //   Therefore: RL odds for +1.5 side MUST be more negative than ML odds
  //   i.e., implied(RL_odds) > implied(ML_odds) for the underdog
  {
    id: 'BUG1_TOR_CANONICAL',
    awayTeam: 'TOR', homeTeam: 'ATL',
    // From screenshot: TOR model ML = +155, TOR model RL shows -132
    // TOR is the AWAY team
    bkAwayML: null, bkHomeML: null,  // not shown in screenshot
    mdlAwayML: 155,   // model ML for TOR (away) = +155 (underdog)
    mdlHomeML: null,
    bkAwayRLOdds: null, bkHomeRLOdds: null,
    mdlAwayRLOdds: -132,  // BUG: model RL for TOR shows -132 (WRONG — should be more negative for underdog covering +1.5)
    mdlHomeRLOdds: null,
    awayRunLine: '+1.5',  // TOR is underdog, gets +1.5
    homeRunLine: '-1.5',
    spreadEdge: null,
    note: 'TOR model ML=+155 (underdog) but model RL=-132 (favorite odds). INVARIANT VIOLATION.'
  },

  // ── BUG 2: CLE +1.5 book -103 vs model +104 shows as edge ──────────────────
  {
    id: 'BUG2_CLE_CANONICAL',
    awayTeam: 'CLE', homeTeam: 'UNKNOWN',
    bkAwayML: null, bkHomeML: null,
    mdlAwayML: null, mdlHomeML: null,
    bkAwayRLOdds: -103,   // book: CLE +1.5 at -103
    bkHomeRLOdds: null,
    mdlAwayRLOdds: 104,   // model: CLE +1.5 at +104 (model LESS confident than book)
    mdlHomeRLOdds: null,
    awayRunLine: '+1.5',
    homeRunLine: '-1.5',
    spreadEdge: 'CLE +1.5 [EDGE]',  // BUG: shows as edge
    note: 'CLE +1.5: book=-103 (50.74% implied), model=+104 (49.02% implied). Model LESS confident → NO EDGE under Option B.'
  },

  // ── BUG 3: SD +1.5 book -175 vs model -167 shows as edge ───────────────────
  {
    id: 'BUG3_SD_CANONICAL',
    awayTeam: 'SD', homeTeam: 'PHI',
    // From DB: SD@PHI — awayRunLine=+1.5, awayRunLineOdds=-175, modelAwaySpreadOdds=-167
    bkAwayML: 123, bkHomeML: -149,
    mdlAwayML: 113, mdlHomeML: -113,
    bkAwayRLOdds: -175,   // book: SD +1.5 at -175
    bkHomeRLOdds: 144,
    mdlAwayRLOdds: -167,  // model: SD +1.5 at -167 (model LESS confident than book)
    mdlHomeRLOdds: 167,
    awayRunLine: '+1.5',
    homeRunLine: '-1.5',
    spreadEdge: null,  // DB shows null — but screenshot shows it highlighted as edge
    spreadDiff: '-1.9',
    note: 'SD +1.5: book=-175 (63.64% implied), model=-167 (62.55% implied). Model LESS confident → NO EDGE under Option B.'
  },

  // ── REAL TODAY GAMES for cross-validation ───────────────────────────────────
  // BAL@BOS: shows edge "BOS -1.5 [EDGE]" — let's verify this is correct
  {
    id: 'VALIDATE_BAL_BOS',
    awayTeam: 'BAL', homeTeam: 'BOS',
    bkAwayML: 113, bkHomeML: -136,
    mdlAwayML: 144, mdlHomeML: -144,
    bkAwayRLOdds: -180,  // BAL +1.5 at -180
    bkHomeRLOdds: 148,   // BOS -1.5 at +148
    mdlAwayRLOdds: -140, // model BAL +1.5 at -140
    mdlHomeRLOdds: 140,  // model BOS -1.5 at +140
    awayRunLine: '+1.5',
    homeRunLine: '-1.5',
    spreadEdge: 'BOS -1.5 [EDGE]',
    spreadDiff: '2.7',
    note: 'BOS -1.5 edge: verify Option B correctness'
  },

  // NYM@SEA: shows edge "SEA -1.5 [EDGE]" — let's verify
  {
    id: 'VALIDATE_NYM_SEA',
    awayTeam: 'NYM', homeTeam: 'SEA',
    bkAwayML: 123, bkHomeML: -149,
    mdlAwayML: 229, mdlHomeML: -229,
    bkAwayRLOdds: -172,  // NYM +1.5 at -172
    bkHomeRLOdds: 142,   // SEA -1.5 at +142
    mdlAwayRLOdds: 112,  // model NYM +1.5 at +112 ← BUG: underdog +1.5 should be negative odds
    mdlHomeRLOdds: -112, // model SEA -1.5 at -112
    awayRunLine: '+1.5',
    homeRunLine: '-1.5',
    spreadEdge: 'SEA -1.5 [EDGE]',
    spreadDiff: '12.1',
    note: 'NYM@SEA: model NYM +1.5 = +112 but book = -172. MASSIVE underdog model. Check invariant.'
  },

  // TEX@STL: shows edge "STL +1.5 [EDGE]" — TEX is away -1.5 fav
  {
    id: 'VALIDATE_TEX_STL',
    awayTeam: 'TEX', homeTeam: 'STL',
    bkAwayML: -110, bkHomeML: -110,
    mdlAwayML: 118, mdlHomeML: -118,
    bkAwayRLOdds: 157,   // TEX -1.5 at +157
    bkHomeRLOdds: -192,  // STL +1.5 at -192
    mdlAwayRLOdds: 181,  // model TEX -1.5 at +181
    mdlHomeRLOdds: -181, // model STL +1.5 at -181
    awayRunLine: '-1.5',
    homeRunLine: '+1.5',
    spreadEdge: 'STL +1.5 [EDGE]',
    spreadDiff: '0.0',
    note: 'TEX@STL: spreadDiff=0.0 but shows edge. BUG: simulation cover% vs break-even triggered false edge.'
  },
];

console.log('\n' + '═'.repeat(100));
console.log('  MLB RUN LINE ROOT CAUSE ANALYSIS — FULL MATHEMATICAL AUDIT');
console.log('  Date: June 2, 2026 | Option B Rule: modelImplied > bookImplied (raw vs raw)');
console.log('═'.repeat(100));

for (const g of games) {
  console.log('\n' + '─'.repeat(100));
  console.log(`[GAME] ${g.id}  ${g.awayTeam}@${g.homeTeam}`);
  console.log(`[NOTE] ${g.note}`);
  console.log('─'.repeat(100));

  // ── BUG 1 ANALYSIS: RL odds mapping invariant ─────────────────────────────
  if (g.mdlAwayML !== null && g.mdlAwayRLOdds !== null) {
    console.log('\n  [BUG 1 CHECK: RL ODDS MAPPING INVARIANT]');
    const mdlAwayMLImpl = implied(g.mdlAwayML);
    const mdlAwayRLImpl = implied(g.mdlAwayRLOdds);
    const awayIsUnderdog = g.mdlAwayML > 0;

    console.log(`  [INPUT]  awayTeam=${g.awayTeam} awayRunLine=${g.awayRunLine}`);
    console.log(`  [INPUT]  modelAwayML=${g.mdlAwayML} → implied=${fmt(mdlAwayMLImpl)} (${awayIsUnderdog ? 'UNDERDOG' : 'FAVORITE'})`);
    console.log(`  [INPUT]  modelAwayRLOdds=${g.mdlAwayRLOdds} → implied=${fmt(mdlAwayRLImpl)}`);

    if (awayIsUnderdog && g.awayRunLine === '+1.5') {
      // Invariant: P(underdog covers +1.5) > P(underdog wins outright)
      // Therefore: implied(RL_odds for +1.5) > implied(ML_odds)
      const invariantOk = mdlAwayRLImpl > mdlAwayMLImpl;
      console.log(`  [INVARIANT] Away underdog +1.5: P(cover +1.5) > P(win outright)`);
      console.log(`  [INVARIANT] modelRLImpl(${fmt(mdlAwayRLImpl)}) > modelMLImpl(${fmt(mdlAwayMLImpl)}) = ${invariantOk}`);
      if (!invariantOk) {
        console.log(`  [BUG 1 CONFIRMED] ✗ INVARIANT VIOLATED`);
        console.log(`  [ROOT CAUSE] modelAwaySpreadOdds=${g.mdlAwayRLOdds} is the FAVORITE's RL odds, not the underdog's.`);
        console.log(`  [ROOT CAUSE] Python engine: rl_away_odds = prob_to_ml(p_arl) where p_arl = P(away covers their spread)`);
        console.log(`  [ROOT CAUSE] When away is +1.5 (underdog), p_arl = P(away covers +1.5) should be > 50%`);
        console.log(`  [ROOT CAUSE] But the DB shows modelAwaySpreadOdds=${g.mdlAwayRLOdds} → implied=${fmt(mdlAwayRLImpl)} < ${fmt(mdlAwayMLImpl)}`);
        console.log(`  [ROOT CAUSE] This means p_arl < p_away_win — IMPOSSIBLE for a +1.5 underdog.`);
        console.log(`  [ROOT CAUSE] CONCLUSION: away_rl_odds and home_rl_odds are SWAPPED in the DB write.`);
        console.log(`  [FIX] In mlbModelRunner.ts line 2329-2330:`);
        console.log(`         CURRENT:  modelAwaySpreadOdds = fmtMl(r.away_rl_odds)`);
        console.log(`                   modelHomeSpreadOdds = fmtMl(r.home_rl_odds)`);
        console.log(`         CORRECT:  modelAwaySpreadOdds = fmtMl(r.away_rl_odds)  ← KEEP (Python already correct)`);
        console.log(`         OR: verify Python engine rl_away_odds = P(away covers away_run_line)`);
      } else {
        console.log(`  [BUG 1 CHECK] ✓ PASS — invariant holds`);
      }
    } else if (!awayIsUnderdog && g.awayRunLine === '-1.5') {
      // Invariant: P(favorite covers -1.5) < P(favorite wins outright)
      const invariantOk = mdlAwayRLImpl < mdlAwayMLImpl;
      console.log(`  [INVARIANT] Away favorite -1.5: P(cover -1.5) < P(win outright)`);
      console.log(`  [INVARIANT] modelRLImpl(${fmt(mdlAwayRLImpl)}) < modelMLImpl(${fmt(mdlAwayMLImpl)}) = ${invariantOk}`);
      if (!invariantOk) {
        console.log(`  [BUG 1 CONFIRMED] ✗ INVARIANT VIOLATED`);
      } else {
        console.log(`  [BUG 1 CHECK] ✓ PASS — invariant holds`);
      }
    }
  }

  // ── BUG 2/3 ANALYSIS: Option B edge detection ─────────────────────────────
  if (g.bkAwayRLOdds !== null && g.mdlAwayRLOdds !== null) {
    console.log('\n  [BUG 2/3 CHECK: OPTION B EDGE DETECTION]');

    const bkAwayImpl = implied(g.bkAwayRLOdds);
    const mdlAwayImpl = implied(g.mdlAwayRLOdds);
    const awayOptionB = mdlAwayImpl - bkAwayImpl;
    const awayEdge = awayOptionB > 0;

    console.log(`  [INPUT]  AWAY ${g.awayRunLine}: book=${g.bkAwayRLOdds} (impl=${fmt(bkAwayImpl)})  model=${g.mdlAwayRLOdds} (impl=${fmt(mdlAwayImpl)})`);
    console.log(`  [STATE]  AWAY Option B diff: model(${fmt(mdlAwayImpl)}) - book(${fmt(bkAwayImpl)}) = ${fmtDiff(awayOptionB)}`);
    console.log(`  [STATE]  AWAY edge: ${awayEdge ? 'YES ✓' : 'NO ✗'}`);

    if (g.bkHomeRLOdds !== null && g.mdlHomeRLOdds !== null) {
      const bkHomeImpl = implied(g.bkHomeRLOdds);
      const mdlHomeImpl = implied(g.mdlHomeRLOdds);
      const homeOptionB = mdlHomeImpl - bkHomeImpl;
      const homeEdge = homeOptionB > 0;

      console.log(`  [INPUT]  HOME ${g.homeRunLine}: book=${g.bkHomeRLOdds} (impl=${fmt(bkHomeImpl)})  model=${g.mdlHomeRLOdds} (impl=${fmt(mdlHomeImpl)})`);
      console.log(`  [STATE]  HOME Option B diff: model(${fmt(mdlHomeImpl)}) - book(${fmt(bkHomeImpl)}) = ${fmtDiff(homeOptionB)}`);
      console.log(`  [STATE]  HOME edge: ${homeEdge ? 'YES ✓' : 'NO ✗'}`);

      const correctEdge = awayEdge ? `${g.awayTeam} ${g.awayRunLine}` : homeEdge ? `${g.homeTeam} ${g.homeRunLine}` : 'NONE';
      const dbEdge = g.spreadEdge ?? 'NONE (null)';
      console.log(`  [OUTPUT] Correct Option B edge: ${correctEdge}`);
      console.log(`  [OUTPUT] DB spreadEdge: "${dbEdge}"`);

      if (!awayEdge && !homeEdge && g.spreadEdge && g.spreadEdge !== 'PASS') {
        console.log(`  [BUG 2/3 CONFIRMED] ✗ DB shows edge "${g.spreadEdge}" but Option B says NO EDGE`);
        console.log(`  [ROOT CAUSE] mlbModelRunner.ts RL edge detection uses SIMULATION COVER% vs BREAK-EVEN:`);
        console.log(`               edgeAway = _mlbRlAwayCoverPct - _bkAwayBreakEven`);
        console.log(`               This is NOT Option B. It compares simulation probability against book break-even.`);
        console.log(`               The simulation cover% can be slightly above break-even even when model odds < book odds.`);
        console.log(`  [FIX] Change RL edge detection to Option B (model odds → implied vs book odds → implied):`);
        console.log(`         edgeAway = americanToImplied(r.away_rl_odds) - americanToImplied(bkAwayRLOdds)`);
        console.log(`         edgeHome = americanToImplied(r.home_rl_odds) - americanToImplied(bkHomeRLOdds)`);
      } else if ((awayEdge || homeEdge) && g.spreadEdge && g.spreadEdge !== 'PASS') {
        console.log(`  [VALIDATE] ✓ Edge confirmed by Option B — DB label matches`);
      } else if (!awayEdge && !homeEdge && (!g.spreadEdge || g.spreadEdge === 'PASS' || g.spreadEdge === 'null')) {
        console.log(`  [VALIDATE] ✓ No edge confirmed by Option B — DB correctly shows no edge`);
      }
    }

    // ── CURRENT (BROKEN) formula analysis ─────────────────────────────────
    console.log('\n  [CURRENT BROKEN FORMULA: simulation cover% vs break-even]');
    console.log(`  [FORMULA] edgeAway = _mlbRlAwayCoverPct - _bkAwayBreakEven`);
    console.log(`  [PROBLEM] _mlbRlAwayCoverPct comes from Monte Carlo simulation (raw %)`);
    console.log(`            _bkAwayBreakEven = implied(bkAwayRLOdds) (raw implied)`);
    console.log(`  [PROBLEM] These are NOT the same as Option B:`);
    console.log(`            Option B: implied(modelRLOdds) vs implied(bookRLOdds)`);
    console.log(`            Current:  simulationCoverPct vs implied(bookRLOdds)`);
    console.log(`  [PROBLEM] The model converts simulation cover% to odds via prob_to_ml() in Python.`);
    console.log(`            But prob_to_ml() applies remove_vig() FIRST, then converts.`);
    console.log(`            So: modelRLOdds = prob_to_ml(remove_vig(simulationCoverPct))`);
    console.log(`            And: implied(modelRLOdds) ≠ simulationCoverPct (they differ by vig removal)`);
    console.log(`  [EXAMPLE] If simulationCoverPct=51.0% and bkBreakEven=50.74% → edgeAway=+0.26pp → EDGE`);
    console.log(`            But: remove_vig(51.0%, 49.0%) → p_arl_nv ≈ 50.98%`);
    console.log(`            prob_to_ml(50.98%) ≈ +104 (slightly positive)`);
    console.log(`            implied(+104) = 49.02% < 50.74% → NO EDGE under Option B`);
    console.log(`  [CONCLUSION] The current formula produces FALSE EDGES because it uses raw simulation`);
    console.log(`               cover% instead of the no-vig model implied probability.`);
  }
}

// ── SUMMARY OF ALL BUGS ────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(100));
console.log('  ROOT CAUSE SUMMARY');
console.log('═'.repeat(100));

console.log(`
BUG 1: TOR model RL shows -132 when model ML is +155
─────────────────────────────────────────────────────
ROOT CAUSE: modelAwaySpreadOdds in DB contains the WRONG team's RL odds.
  - TOR is the AWAY UNDERDOG (ML = +155, implied = 39.22%)
  - TOR gets +1.5 run line (easier to cover than win outright)
  - P(TOR covers +1.5) MUST be > P(TOR wins) = 39.22%
  - Therefore: modelAwaySpreadOdds for TOR +1.5 MUST have implied > 39.22%
  - But DB shows modelAwaySpreadOdds = -132 → implied = 56.90%
  
  WAIT — -132 → 56.90% IS > 39.22%. So the invariant HOLDS.
  
  RE-ANALYSIS: The display shows "TOR -1.5 -132" which means the LABEL shows -1.5
  but the ODDS show -132. This is a LABEL vs ODDS mismatch:
  - awayModelSpread = "-1.5" (wrong — TOR should be +1.5)
  - modelAwaySpreadOdds = "-132" (this is the -1.5 favorite's odds)
  
  The awayModelSpread label is being set to "-1.5" when TOR is actually +1.5.
  This means safeAwayRunLine is being set incorrectly in the RL sign guard.
  
  ACTUAL ROOT CAUSE: The RL sign guard in mlbModelRunner.ts is SWAPPING the 
  awayModelSpread label. The safeAwayRunLine is being set to "-1.5" for TOR 
  when it should be "+1.5". The modelAwaySpreadOdds (-132) is the correct 
  odds for the -1.5 side (home favorite), but it's being DISPLAYED under TOR.

BUG 2: CLE +1.5 book -103 vs model +104 shows as edge
───────────────────────────────────────────────────────
ROOT CAUSE: RL edge detection uses simulation cover% vs break-even, NOT Option B.
  - Book: CLE +1.5 at -103 → bookImplied = 50.74%
  - Model: CLE +1.5 at +104 → modelImplied = 49.02%
  - Option B: 49.02% < 50.74% → NO EDGE
  - BUT: simulation cover% for CLE might be ~51% (slightly above break-even)
  - Current formula: edgeAway = 0.51 - 0.5074 = +0.26pp > 0 → FALSE EDGE
  
  FIX: Replace simulation cover% with model implied probability:
    edgeAway = americanToImplied(r.away_rl_odds) - americanToImplied(bkAwayRLOdds)

BUG 3: SD +1.5 book -175 vs model -167 shows as edge  
───────────────────────────────────────────────────────
ROOT CAUSE: Same as Bug 2 — simulation cover% vs break-even.
  - Book: SD +1.5 at -175 → bookImplied = 63.64%
  - Model: SD +1.5 at -167 → modelImplied = 62.55%
  - Option B: 62.55% < 63.64% → NO EDGE
  - DB shows spreadDiff=-1.9 and spreadEdge=null — so DB is CORRECT for SD@PHI.
  - The screenshot showing SD as edge may be from a DIFFERENT game or date.
  - SD@PHI today: DB correctly shows NO edge (spreadEdge=null, spreadDiff=-1.9).
  
  HOWEVER: The formula is still broken for other games. See TEX@STL:
  - spreadDiff=0.0 but spreadEdge="STL +1.5 [EDGE]" — this is a false edge.
  - STL +1.5: book=-192, model=-181 → modelImplied=64.42% < bookImplied=65.75% → NO EDGE
  - Current formula: simulation cover% for STL ≈ 65.75% + epsilon → false edge

ADDITIONAL BUG: NYM@SEA model NYM +1.5 = +112 (INVARIANT VIOLATION)
──────────────────────────────────────────────────────────────────────
  - NYM is away underdog (ML = +123, implied = 44.84%)
  - NYM gets +1.5 run line
  - P(NYM covers +1.5) MUST be > P(NYM wins) = 44.84%
  - modelAwaySpreadOdds = +112 → implied = 47.17% > 44.84% ✓ (invariant holds)
  - BUT: book NYM +1.5 = -172 → bookImplied = 63.24%
  - model NYM +1.5 = +112 → modelImplied = 47.17%
  - Option B: 47.17% < 63.24% → NO EDGE for NYM +1.5
  - Yet DB shows spreadEdge = "SEA -1.5 [EDGE]" with spreadDiff=12.1
  - SEA -1.5: book=+142, model=-112 → modelImplied=52.83% vs bookImplied=41.38% → EDGE ✓
  - This edge IS correct under Option B for SEA -1.5!
  
  BUT WAIT: model NYM +1.5 = +112 is WRONG. If SEA model ML = -229 (implied=69.63%),
  then SEA -1.5 model implied should be LESS than 69.63%.
  SEA -1.5 model = -112 → implied = 52.83% < 69.63% ✓ (invariant holds for SEA)
  But NYM +1.5 = +112 → implied = 47.17% which is LESS than NYM ML implied (30.37%).
  WAIT: NYM model ML = +229 → implied = 30.37%. NYM +1.5 implied = 47.17% > 30.37% ✓
  Invariant holds. The +112 is correct (NYM is a big underdog, even +1.5 is hard to cover).
  
  CONCLUSION: NYM@SEA edge is CORRECT. The "SEA -1.5 [EDGE]" is valid under Option B.
`);

console.log('═'.repeat(100));
console.log('  FIXES REQUIRED');
console.log('═'.repeat(100));
console.log(`
FIX 1 (Bug 1 — RL label swap):
  File: server/mlbModelRunner.ts
  Location: Lines 2063-2090 (safeAwayRunLine/safeHomeRunLine assignment)
  Issue: The RL sign guard may be incorrectly setting safeAwayRunLine to "-1.5" 
         for TOR when TOR is the away underdog (+1.5).
  Need: Read the sign guard logic to find where the swap occurs.

FIX 2 (Bugs 2/3 — Option B for RL):
  File: server/mlbModelRunner.ts
  Location: Lines 2165-2168 (RL edge detection)
  CURRENT (BROKEN):
    const edgeAway = _mlbRlAwayCoverPct - _bkAwayBreakEven;
    const edgeHome = _mlbRlHomeCoverPct - _bkHomeBreakEven;
  CORRECT (Option B):
    const edgeAway = _americanBreakEven(_mlbRlAwayOdds) - _bkAwayBreakEven;
    const edgeHome = _americanBreakEven(_mlbRlHomeOdds) - _bkHomeBreakEven;
  WHERE:
    _mlbRlAwayOdds = r.away_rl_odds  (already defined at line 2144)
    _mlbRlHomeOdds = r.home_rl_odds  (already defined at line 2145)
    _bkAwayBreakEven = implied(bkAwayRLOdds)  (already computed at line 2161)
    _bkHomeBreakEven = implied(bkHomeRLOdds)  (already computed at line 2162)
  
  This replaces simulation cover% with model implied probability (no-vig).
  The model's rl_away_odds is already the no-vig fair price from prob_to_ml(remove_vig(p_arl)).
  So implied(r.away_rl_odds) IS the no-vig model probability — exactly what Option B requires.
`);
