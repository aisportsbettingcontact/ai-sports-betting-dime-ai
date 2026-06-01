/**
 * validateOptionB.mjs
 * Mathematical validation of Option B edge detection rule.
 * Option B: edge exists ONLY when modelImplied(side) > bookImplied(side) — both RAW, same side.
 *
 * CORRECTED VALUES (confirmed by user):
 *   SF +1.5: Book -181, Model -134  → NOT the edge
 *   MIL -1.5: Book +149, Model +134 → THIS IS THE EDGE
 */

function implied(ml) {
  if (ml < 0) return (-ml) / (-ml + 100);
  return 100 / (ml + 100);
}

function edgePP(modelML, bookML) {
  return (implied(modelML) - implied(bookML)) * 100;
}

function roi(modelML, bookML, bookOppML) {
  const modelImp = implied(modelML);
  const rawBook  = implied(bookML);
  const rawOpp   = implied(bookOppML);
  const vigTotal = rawBook + rawOpp;
  const bookNoVig = rawBook / vigTotal;
  return (modelImp / bookNoVig - 1) * 100;
}

console.log('═══════════════════════════════════════════════════════════');
console.log('  OPTION B EDGE DETECTION — CORRECTED FULL AUDIT');
console.log('  Rule: edge = modelImplied(side) > bookImplied(side) [raw]');
console.log('═══════════════════════════════════════════════════════════\n');

// ── Case 1: u7.5 — book=-123/+102, model=-116/+116 ──────────────────────────
console.log('─── CASE 1: u7.5 ───────────────────────────────────────────');
// UNDER side
const c1bkUnder = -123, c1mdlUnder = -116, c1bkOver = 102, c1mdlOver = 116;
console.log(`[INPUT] Book: o7.5 (+${c1bkOver}) / u7.5 (${c1bkUnder})`);
console.log(`[INPUT] Model: o7.5 (+${c1mdlOver}) / u7.5 (${c1mdlUnder})`);
const c1mdlUnderImp = implied(c1mdlUnder);
const c1bkUnderImp  = implied(c1bkUnder);
const c1mdlOverImp  = implied(c1mdlOver);
const c1bkOverImp   = implied(c1bkOver);
console.log(`[STEP]  UNDER: modelImplied(${c1mdlUnder}) = ${c1mdlUnderImp.toFixed(6)} (${(c1mdlUnderImp*100).toFixed(2)}%)`);
console.log(`[STEP]  UNDER: bookImplied(${c1bkUnder})   = ${c1bkUnderImp.toFixed(6)} (${(c1bkUnderImp*100).toFixed(2)}%)`);
console.log(`[STEP]  OVER:  modelImplied(+${c1mdlOver}) = ${c1mdlOverImp.toFixed(6)} (${(c1mdlOverImp*100).toFixed(2)}%)`);
console.log(`[STEP]  OVER:  bookImplied(+${c1bkOver})   = ${c1bkOverImp.toFixed(6)} (${(c1bkOverImp*100).toFixed(2)}%)`);
const c1underEdge = c1mdlUnderImp > c1bkUnderImp;
const c1overEdge  = c1mdlOverImp  > c1bkOverImp;
console.log(`[VERIFY] UNDER edge: ${c1mdlUnderImp.toFixed(4)} > ${c1bkUnderImp.toFixed(4)}? ${c1underEdge ? '✓ YES' : '✗ NO'}`);
console.log(`[VERIFY] OVER  edge: ${c1mdlOverImp.toFixed(4)} > ${c1bkOverImp.toFixed(4)}? ${c1overEdge ? '✓ YES' : '✗ NO'}`);
console.log(`[OUTPUT] u7.5 → ${c1underEdge ? 'UNDER EDGE (+' + edgePP(c1mdlUnder, c1bkUnder).toFixed(2) + 'pp)' : 'NO EDGE'} | o7.5 → ${c1overEdge ? 'OVER EDGE' : 'NO EDGE'}`);
console.log('');

// ── Case 2: MIL ML — book=-149/+124, model=-149/+134 ────────────────────────
console.log('─── CASE 2: MIL ML ─────────────────────────────────────────');
const c2bkMil = -149, c2mdlMil = -149, c2bkSf = 124, c2mdlSf = 134;
console.log(`[INPUT] Book: MIL (${c2bkMil}) / SF (+${c2bkSf})`);
console.log(`[INPUT] Model: MIL (${c2mdlMil}) / SF (+${c2mdlSf})`);
const c2milEdgePP = edgePP(c2mdlMil, c2bkMil);
const c2sfEdgePP  = edgePP(c2mdlSf, c2bkSf);
console.log(`[STEP]  MIL ML: modelImplied(${c2mdlMil}) = ${implied(c2mdlMil).toFixed(6)} | bookImplied(${c2bkMil}) = ${implied(c2bkMil).toFixed(6)}`);
console.log(`[STEP]  SF  ML: modelImplied(+${c2mdlSf}) = ${implied(c2mdlSf).toFixed(6)} | bookImplied(+${c2bkSf}) = ${implied(c2bkSf).toFixed(6)}`);
console.log(`[VERIFY] MIL ML edge: edgePP = ${c2milEdgePP.toFixed(6)}pp → ${c2milEdgePP > 0 ? 'EDGE' : 'NO EDGE'}`);
console.log(`[VERIFY] SF  ML edge: edgePP = ${c2sfEdgePP.toFixed(4)}pp → ${c2sfEdgePP > 0 ? 'EDGE' : 'NO EDGE'}`);
console.log(`[OUTPUT] MIL ML: NO EDGE (identical odds) | SF ML: ${c2sfEdgePP > 0 ? 'EDGE' : 'NO EDGE'}`);
console.log('');

// ── Case 3: MIL RL — CORRECTED VALUES ────────────────────────────────────────
console.log('─── CASE 3: MIL RL (CORRECTED) ─────────────────────────────');
console.log('  SF  +1.5: Book -181, Model -134  → NOT the edge (user confirmed)');
console.log('  MIL -1.5: Book +149, Model +134  → THIS IS THE EDGE (user confirmed)');
console.log('');
const c3sfBk = -181, c3sfMdl = -134;   // SF +1.5 side
const c3milBk = 149, c3milMdl = 134;   // MIL -1.5 side (both positive = underdog odds for covering)
console.log(`[INPUT] SF  +1.5: Book (${c3sfBk}), Model (${c3sfMdl})`);
console.log(`[INPUT] MIL -1.5: Book (+${c3milBk}), Model (+${c3milMdl})`);
const c3sfMdlImp  = implied(c3sfMdl);
const c3sfBkImp   = implied(c3sfBk);
const c3milMdlImp = implied(c3milMdl);
const c3milBkImp  = implied(c3milBk);
console.log(`[STEP]  SF  +1.5: modelImplied(${c3sfMdl}) = ${c3sfMdlImp.toFixed(6)} (${(c3sfMdlImp*100).toFixed(2)}%)`);
console.log(`[STEP]  SF  +1.5: bookImplied(${c3sfBk})   = ${c3sfBkImp.toFixed(6)} (${(c3sfBkImp*100).toFixed(2)}%)`);
console.log(`[STEP]  MIL -1.5: modelImplied(+${c3milMdl}) = ${c3milMdlImp.toFixed(6)} (${(c3milMdlImp*100).toFixed(2)}%)`);
console.log(`[STEP]  MIL -1.5: bookImplied(+${c3milBk})   = ${c3milBkImp.toFixed(6)} (${(c3milBkImp*100).toFixed(2)}%)`);
const c3sfEdgePP  = edgePP(c3sfMdl, c3sfBk);
const c3milEdgePP = edgePP(c3milMdl, c3milBk);
console.log(`[STEP]  SF  +1.5 edgePP = ${c3sfEdgePP.toFixed(4)}pp`);
console.log(`[STEP]  MIL -1.5 edgePP = ${c3milEdgePP.toFixed(4)}pp`);
console.log(`[VERIFY] SF  +1.5: ${c3sfMdlImp.toFixed(4)} > ${c3sfBkImp.toFixed(4)}? ${c3sfMdlImp > c3sfBkImp ? '✓ YES — EDGE' : '✗ NO — NO EDGE'}`);
console.log(`[VERIFY] MIL -1.5: ${c3milMdlImp.toFixed(4)} > ${c3milBkImp.toFixed(4)}? ${c3milMdlImp > c3milBkImp ? '✓ YES — EDGE' : '✗ NO — NO EDGE'}`);
if (c3milMdlImp > c3milBkImp) {
  const c3roi = roi(c3milMdl, c3milBk, c3sfBk);
  console.log(`[OUTPUT] MIL -1.5 EDGE confirmed | edgePP=${c3milEdgePP.toFixed(2)}pp | ROI=${c3roi.toFixed(2)}%`);
}
console.log('');

// ── Summary ──────────────────────────────────────────────────────────────────
console.log('═══════════════════════════════════════════════════════════');
console.log('  SUMMARY — OPTION B RESULTS (CORRECTED)');
console.log('═══════════════════════════════════════════════════════════');
console.log(`  u7.5  model=-116 vs book=-123: ${c1underEdge ? 'EDGE' : 'NO EDGE'} (model ${c1underEdge?'>':'<'} book)`);
console.log(`  MIL ML model=-149 vs book=-149: NO EDGE (identical)`);
console.log(`  SF  +1.5 model=-134 vs book=-181: ${c3sfMdlImp > c3sfBkImp ? 'EDGE' : 'NO EDGE'} (model ${c3sfMdlImp > c3sfBkImp?'>':'<'} book)`);
console.log(`  MIL -1.5 model=+134 vs book=+149: ${c3milMdlImp > c3milBkImp ? 'EDGE ✓' : 'NO EDGE'} (model ${c3milMdlImp > c3milBkImp?'>':'<'} book)`);
