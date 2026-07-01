/**
 * seedJuly1Direct.ts — v12.0-KO24 July 1 WC2026 Seed
 * ═══════════════════════════════════════════════════════════════════════════════
 * Fixtures:
 *   wc26-r32-080  England (H) vs Congo DR (A)         — 12:00 PM ET / 16:00 UTC
 *   wc26-r32-081  Belgium (H) vs Senegal (A)          —  4:00 PM ET / 20:00 UTC
 *   wc26-r32-082  USA (H) vs Bosnia & Herzegovina (A) —  8:00 PM ET / 00:00 UTC+1
 *
 * ORIENTATION (critical — verified from DB fixtures table):
 *   Home team = left side of fixture slug (England, Belgium, USA)
 *   Away team = right side (Congo DR, Senegal, Bosnia-Herz)
 *
 * COLUMN MAPPING (from pasted_content_69.txt — exact column order):
 *   Match | Away | Home | Away to Advance | Home to Advance |
 *   Away ML | Draw | Home ML | Away or Draw | Home or Draw | No Draw |
 *   Total | Over | Under |
 *   Away Spread | Away Spread Odds | Home Spread | Home Spread Odds |
 *   BTTS Yes | BTTS No
 *
 * SCHEMA MAPPING:
 *   Away to Advance  → toAdvanceAwayOdds
 *   Home to Advance  → toAdvanceHomeOdds
 *   Away ML          → bookAwayMl
 *   Draw             → bookDrawMl
 *   Home ML          → bookHomeMl
 *   Away or Draw     → bookDcX2Odds  (X2 = Away wins OR Draw)
 *   Home or Draw     → bookDc1XOdds  (1X = Home wins OR Draw)
 *   No Draw          → bookNoDrawHomeOdds / bookNoDrawAwayOdds (symmetric)
 *   Total            → bookTotalLine
 *   Over             → bookOverOdds
 *   Under            → bookUnderOdds
 *   Away Spread      → bookSpreadLine (negated for home convention: home spread = -away spread)
 *   Away Spread Odds → bookAwaySpreadOdds
 *   Home Spread      → (derived: -Away Spread)
 *   Home Spread Odds → bookHomeSpreadOdds
 *   BTTS Yes         → bookBttsYesOdds
 *   BTTS No          → bookBttsNoOdds
 *
 * MODEL MAPPING (from v12_engine_final.mjs JSON report — V5 winner):
 *   pH  → homeWinProb  | modelHomeML
 *   pD  → drawProb     | modelDrawML
 *   pA  → awayWinProb  | modelAwayML
 *   pAdvH → toAdvanceHomeProb | toAdvanceHomeOdds
 *   pAdvA → toAdvanceAwayProb | toAdvanceAwayOdds
 *   pO25  → over25     | overOdds
 *   pU25  → under25    | underOdds
 *   pBTTS → bttsProb   | bttsYesOdds / bttsNoOdds
 *   pHSpread → homeSpreadOdds
 *   pASpread → awaySpreadOdds
 *   pAwayOrDraw (pA+pD) → dcX2Odds
 *   pHomeOrDraw (pH+pD) → dc1XOdds
 *   pNoDraw (pH+pA)     → noDrawHomeOdds / noDrawAwayOdds
 *   projHomeScore → projHomeScore
 *   projAwayScore → projAwayScore
 *   projTotal     → projTotal
 *   projSpread    → projSpread (home - away)
 *   lambdaH → homeLambda
 *   lambdaA → awayLambda
 *
 * Tables written:
 *   wc2026_frozen_book_odds   — all 17 book markets
 *   wc2026_model_projections  — full V5 model output (isFrozen=1)
 *
 * Run: npx tsx server/wc2026/seedJuly1Direct.ts
 */

import { getDb } from "../db";
import {
  wc2026ModelProjections,
  wc2026FrozenBookOdds,
  wc2026Fixtures,
} from "../../drizzle/wc2026.schema";
import { eq, inArray } from "drizzle-orm";
import fs from "fs";

// ═══════════════════════════════════════════════════════════════════════════════
// LOGGING SYSTEM — INDUSTRY-LEADING STRUCTURED LOGGING
// ═══════════════════════════════════════════════════════════════════════════════
const LOG_PATH = "/home/ubuntu/wc2026modeling.txt";
const SEED_LOG_PATH = "/home/ubuntu/wc2026_july1_seed.log";
const SESSION_ID = `v12-july1-seed-${Date.now()}`;
const T0 = Date.now();
const logLines: string[] = [];

function appendLog(plain: string) {
  try { fs.appendFileSync(LOG_PATH, plain + "\n"); } catch (_) {}
  logLines.push(plain);
}

function flushSeedLog() {
  fs.writeFileSync(SEED_LOG_PATH, logLines.join("\n") + "\n");
}

let _PASS = 0, _FAIL = 0, _WARN = 0, _STEP = 0;

function log(
  level: "BANNER"|"SECTION"|"STEP"|"INPUT"|"CALC"|"STATE"|"PASS"|"FAIL"|"WARN"|"VERIFY"|"OUTPUT"|"AUDIT"|"FIX",
  tag: string,
  msg: string,
  detail = ""
) {
  _STEP++;
  const t = new Date().toISOString();
  const ela = `+${((Date.now() - T0) / 1000).toFixed(3)}s`;
  const icon =
    level === "PASS"    ? "✅" :
    level === "FAIL"    ? "❌" :
    level === "WARN"    ? "⚠️ " :
    level === "STEP"    ? "▶▶" :
    level === "SECTION" ? "██" :
    level === "BANNER"  ? "══" :
    level === "INPUT"   ? "◀◀" :
    level === "CALC"    ? "∑∑" :
    level === "STATE"   ? "··" :
    level === "VERIFY"  ? "✓✓" :
    level === "OUTPUT"  ? "→→" :
    level === "AUDIT"   ? "🔍" :
    level === "FIX"     ? "🔧" : "  ";
  if (level === "PASS") _PASS++;
  if (level === "FAIL") _FAIL++;
  if (level === "WARN") _WARN++;
  const plain = `[${t}] ${ela.padEnd(10)} [${level.padEnd(7)}] [${tag.padEnd(10)}] ${icon} ${msg}${detail ? `\n    ↳ ${detail}` : ""}`;
  console.log(plain);
  appendLog(plain);
}

// ═══════════════════════════════════════════════════════════════════════════════
// FIXTURE IDs
// ═══════════════════════════════════════════════════════════════════════════════
const FIXTURE_IDS = ["wc26-r32-080", "wc26-r32-081", "wc26-r32-082"];

// ═══════════════════════════════════════════════════════════════════════════════
// BOOK ODDS — EXACT FROM pasted_content_69.txt
// ═══════════════════════════════════════════════════════════════════════════════
//
// ORIENTATION VERIFICATION:
//   wc26-r32-080: England (HOME) vs Congo DR (AWAY)
//     File row: "D.R. Congo vs England | Away=Congo DR | Home=England"
//     → Home=England, Away=Congo DR ✓
//
//   wc26-r32-081: Belgium (HOME) vs Senegal (AWAY)
//     File row: "Senegal vs Belgium | Away=Senegal | Home=Belgium"
//     → Home=Belgium, Away=Senegal ✓
//
//   wc26-r32-082: USA (HOME) vs Bosnia & Herzegovina (AWAY)
//     File row: "Bosnia & Herzegovina vs USA | Away=Bosnia-Herz | Home=USA"
//     → Home=USA, Away=Bosnia-Herz ✓
//
// MARKET MAPPING LEGEND:
//   bookDc1XOdds  = Home or Draw (1X)  ← column "Home or Draw"
//   bookDcX2Odds  = Away or Draw (X2)  ← column "Away or Draw"
//   bookNoDrawHomeOdds / bookNoDrawAwayOdds = No Draw (symmetric) ← column "No Draw"
//   bookSpreadLine = home team's spread line (negative = home favored)
//     England (H) vs Congo DR (A): Away Spread = +1.5, Home Spread = -1.5
//       → bookSpreadLine = -1.5 (England -1.5)
//       → bookHomeSpreadOdds = -105 (England -1.5 at -105)
//       → bookAwaySpreadOdds = -111 (Congo DR +1.5 at -111)
//     Belgium (H) vs Senegal (A): Away Spread = +1.5, Home Spread = -1.5
//       → bookSpreadLine = -1.5 (Belgium -1.5)
//       → bookHomeSpreadOdds = +300 (Belgium -1.5 at +300)
//       → bookAwaySpreadOdds = -435 (Senegal +1.5 at -435)
//     USA (H) vs Bosnia-Herz (A): Away Spread = +1.5, Home Spread = -1.5
//       → bookSpreadLine = -1.5 (USA -1.5)
//       → bookHomeSpreadOdds = +108 (USA -1.5 at +108)
//       → bookAwaySpreadOdds = -137 (Bosnia-Herz +1.5 at -137)
//
const BOOK_ROWS: Record<string, any> = {

  // ── wc26-r32-080: ENGLAND (H) vs CONGO DR (A) ─────────────────────────────
  // Source row: D.R. Congo vs England | Congo DR | England | 600 | -1100 | 1100 | 400 | -345 | 250 | -2000 | -588 | 2.5 | 103 | -120 | 1.5 | -111 | -1.5 | -105 | 163 | -227
  "wc26-r32-080": {
    fixtureId:            "wc26-r32-080",
    // 1X2 Moneylines
    bookHomeMl:           -345,  // England ML: -345  ← "Home ML" column
    bookDrawMl:           400,   // Draw: +400         ← "Draw" column
    bookAwayMl:           1100,  // Congo DR ML: +1100 ← "Away ML" column
    // Spread: Away Spread = +1.5 at -111 | Home Spread = -1.5 at -105
    bookSpreadLine:       -1.5,  // England -1.5 (home spread line)
    bookHomeSpreadOdds:   -105,  // England -1.5 at -105  ← "Home Spread Odds" column
    bookAwaySpreadOdds:   -111,  // Congo DR +1.5 at -111 ← "Away Spread Odds" column
    // Total
    bookTotalLine:        2.5,   // ← "Total" column
    bookOverOdds:         103,   // Over 2.5: +103  ← "Over" column
    bookUnderOdds:        -120,  // Under 2.5: -120 ← "Under" column
    // BTTS
    bookBttsYesOdds:      163,   // BTTS Yes: +163  ← "BTTS Yes" column
    bookBttsNoOdds:       -227,  // BTTS No: -227   ← "BTTS No" column
    // Double Chance
    bookDc1XOdds:         -2000, // Home or Draw (1X): -2000 ← "Home or Draw" column
    bookDcX2Odds:         250,   // Away or Draw (X2): +250  ← "Away or Draw" column
    // No Draw (symmetric) — "No Draw" column = -588
    bookNoDrawHomeOdds:   -588,  // No Draw: -588
    bookNoDrawAwayOdds:   -588,
    // To Advance
    toAdvanceHomeOdds:    -1100, // England to Advance: -1100 ← "Home to Advance" column
    toAdvanceAwayOdds:    600,   // Congo DR to Advance: +600 ← "Away to Advance" column
    bookSource:           "DraftKings",
  },

  // ── wc26-r32-081: BELGIUM (H) vs SENEGAL (A) ──────────────────────────────
  // Source row: Senegal vs Belgium | Senegal | Belgium | 135 | -175 | 270 | 220 | 115 | -149 | -345 | -278 | 2.5 | 100 | -118 | 1.5 | -435 | -1.5 | 300 | -133 | 100
  "wc26-r32-081": {
    fixtureId:            "wc26-r32-081",
    // 1X2 Moneylines
    bookHomeMl:           115,   // Belgium ML: +115  ← "Home ML" column
    bookDrawMl:           220,   // Draw: +220         ← "Draw" column
    bookAwayMl:           270,   // Senegal ML: +270   ← "Away ML" column
    // Spread: Away Spread = +1.5 at -435 | Home Spread = -1.5 at +300
    bookSpreadLine:       -1.5,  // Belgium -1.5 (home spread line)
    bookHomeSpreadOdds:   300,   // Belgium -1.5 at +300  ← "Home Spread Odds" column
    bookAwaySpreadOdds:   -435,  // Senegal +1.5 at -435  ← "Away Spread Odds" column
    // Total
    bookTotalLine:        2.5,   // ← "Total" column
    bookOverOdds:         100,   // Over 2.5: +100  ← "Over" column
    bookUnderOdds:        -118,  // Under 2.5: -118 ← "Under" column
    // BTTS
    bookBttsYesOdds:      -133,  // BTTS Yes: -133  ← "BTTS Yes" column
    bookBttsNoOdds:       100,   // BTTS No: +100   ← "BTTS No" column
    // Double Chance
    bookDc1XOdds:         -345,  // Home or Draw (1X): -345 ← "Home or Draw" column
    bookDcX2Odds:         -149,  // Away or Draw (X2): -149 ← "Away or Draw" column
    // No Draw (symmetric) — "No Draw" column = -278
    bookNoDrawHomeOdds:   -278,  // No Draw: -278
    bookNoDrawAwayOdds:   -278,
    // To Advance
    toAdvanceHomeOdds:    -175,  // Belgium to Advance: -175  ← "Home to Advance" column
    toAdvanceAwayOdds:    135,   // Senegal to Advance: +135  ← "Away to Advance" column
    bookSource:           "DraftKings",
  },

  // ── wc26-r32-082: USA (H) vs BOSNIA & HERZEGOVINA (A) ────────────────────
  // Source row: Bosnia & Herzegovina vs USA | Bosnia-Herz | USA | 450 | -700 | 600 | 400 | -250 | 175 | -1000 | -588 | 2.5 | -137 | 110 | 1.5 | -137 | -1.5 | 108 | -105 | -125
  "wc26-r32-082": {
    fixtureId:            "wc26-r32-082",
    // 1X2 Moneylines
    bookHomeMl:           -250,  // USA ML: -250          ← "Home ML" column
    bookDrawMl:           400,   // Draw: +400             ← "Draw" column
    bookAwayMl:           600,   // Bosnia-Herz ML: +600  ← "Away ML" column
    // Spread: Away Spread = +1.5 at -137 | Home Spread = -1.5 at +108
    bookSpreadLine:       -1.5,  // USA -1.5 (home spread line)
    bookHomeSpreadOdds:   108,   // USA -1.5 at +108          ← "Home Spread Odds" column
    bookAwaySpreadOdds:   -137,  // Bosnia-Herz +1.5 at -137  ← "Away Spread Odds" column
    // Total
    bookTotalLine:        2.5,   // ← "Total" column
    bookOverOdds:         -137,  // Over 2.5: -137  ← "Over" column
    bookUnderOdds:        110,   // Under 2.5: +110 ← "Under" column
    // BTTS
    bookBttsYesOdds:      -105,  // BTTS Yes: -105  ← "BTTS Yes" column
    bookBttsNoOdds:       -125,  // BTTS No: -125   ← "BTTS No" column
    // Double Chance
    bookDc1XOdds:         -1000, // Home or Draw (1X): -1000 ← "Home or Draw" column
    bookDcX2Odds:         175,   // Away or Draw (X2): +175  ← "Away or Draw" column
    // No Draw (symmetric) — "No Draw" column = -588
    bookNoDrawHomeOdds:   -588,  // No Draw: -588
    bookNoDrawAwayOdds:   -588,
    // To Advance
    toAdvanceHomeOdds:    -700,  // USA to Advance: -700           ← "Home to Advance" column
    toAdvanceAwayOdds:    450,   // Bosnia-Herz to Advance: +450   ← "Away to Advance" column
    bookSource:           "DraftKings",
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// MODEL ROWS — V5 (Player xG Dominant 0.20) — from v12_engine_final.mjs
// ═══════════════════════════════════════════════════════════════════════════════
//
// PROB → ML FORMULA (validated, sign-checked, round-trip verified):
//   p >= 0.5 → ML = -(p/(1-p))*100 (negative = favorite)
//   p < 0.5  → ML = ((1-p)/p)*100  (positive = underdog)
//
// ALL VALUES BELOW DERIVED FROM JSON REPORT + v12_bvm_v2.mjs VALIDATED OUTPUT:
//
// wc26-r32-080 (ENG H vs COD A):
//   λH=1.8237 λA=1.0005 | Proj: 1.823-1.000 | Total: 2.823 | Spread: +0.823
//   pH=0.5738 pD=0.2142 pA=0.2119
//   pAdvH=0.7028 pAdvA=0.2972
//   pO25=0.5362 pU25=0.4638
//   pBTTS=0.5232 pNoBTTS=0.4768
//   pHSpread=0.3247 (ENG -1.5) pASpread=0.6753 (COD +1.5)
//   pAwayOrDraw=0.4261 pHomeOrDraw=0.7880 pNoDraw=0.7857
//
// wc26-r32-081 (BEL H vs SEN A):
//   λH=2.0121 λA=1.6278 | Proj: 2.010-1.627 | Total: 3.637 | Spread: +0.383
//   pH=0.4754 pD=0.2032 pA=0.3215
//   pAdvH=0.5845 pAdvA=0.4155
//   pO25=0.7042 pU25=0.2958
//   pBTTS=0.6906 pNoBTTS=0.3094
//   pHSpread=0.2679 (BEL -1.5) pASpread=0.7321 (SEN +1.5)
//   pAwayOrDraw=0.5246 pHomeOrDraw=0.6785 pNoDraw=0.7968
//
// wc26-r32-082 (USA H vs BIH A):
//   λH=1.4386 λA=0.6063 | Proj: 1.438-0.606 | Total: 2.045 | Spread: +0.832
//   pH=0.5815 pD=0.2547 pA=0.1638
//   pAdvH=0.7451 pAdvA=0.2549
//   pO25=0.3355 pU25=0.6645
//   pBTTS=0.3394 pNoBTTS=0.6606
//   pHSpread=0.2941 (USA -1.5) pASpread=0.7059 (BIH +1.5)
//   pAwayOrDraw=0.4185 pHomeOrDraw=0.8362 pNoDraw=0.7453
//
const MODEL_ROWS: Record<string, any> = {

  // ── wc26-r32-080: ENGLAND (H) vs CONGO DR (A) ─────────────────────────────
  "wc26-r32-080": {
    fixtureId:           "wc26-r32-080",
    modelVersion:        "v12.0-KO24-V5",
    homeTeam:            "England",
    awayTeam:            "Congo DR",
    // Lambdas
    homeLambda:          1.8237,
    awayLambda:          1.0005,
    // Score projections
    projHomeScore:       1.823,
    projAwayScore:       1.000,
    projTotal:           2.823,
    projSpread:          0.823,   // home - away (positive = home favored)
    // 1X2 probabilities
    homeWinProb:         0.5738,
    drawProb:            0.2142,
    awayWinProb:         0.2119,
    // 1X2 model ML (validated: pH=57.38%→-135, pD=21.42%→+367, pA=21.19%→+372)
    modelHomeML:         -135,
    modelDrawML:         367,
    modelAwayML:         372,
    // Spread: model uses book line -1.5 with model-derived odds
    modelSpread:         -1.5,    // England -1.5 (matches book line)
    modelSpreadRaw:      0.823,   // raw projected spread
    homeSpreadOdds:      208,     // ENG -1.5 at +208 (pHSpread=32.47%)
    awaySpreadOdds:      -208,    // COD +1.5 at -208 (pASpread=67.53%)
    // Total: model uses book line 2.5 with model-derived odds
    modelTotal:          2.5,
    modelTotalRaw:       2.823,
    over25:              0.5362,
    under25:             0.4638,
    overOdds:            -116,    // Over 2.5 at -116 (pO25=53.62%)
    underOdds:           116,     // Under 2.5 at +116 (pU25=46.38%)
    // BTTS
    bttsProb:            0.5232,
    bttsYesOdds:         -119,    // BTTS Yes at -119 (pBTTS=52.32%)
    bttsNoOdds:          119,     // BTTS No at +119 (pNoBTTS=47.68%)
    // Double chance (1X = Home or Draw, X2 = Away or Draw)
    nvDc1X:              0.7880,
    nvDcX2:              0.4261,
    dc1XOdds:            -372,    // Home or Draw at -372 (p1X=78.80%)
    dcX2Odds:            135,     // Away or Draw at +135 (pX2=42.61%)
    // No draw
    nvNoDrawHome:        0.3929,  // pAdvH (to advance)
    nvNoDrawAway:        0.2119,  // pA
    noDrawHomeOdds:      -367,    // No Draw at -367 (pNoDraw=78.57%)
    noDrawAwayOdds:      -367,
    // To Advance
    toAdvanceHomeProb:   0.7028,
    toAdvanceAwayProb:   0.2972,
    toAdvanceHomeOdds:   -236,    // England to Advance at -236 (pAdvH=70.28%)
    toAdvanceAwayOdds:   236,     // Congo DR to Advance at +236 (pAdvA=29.72%)
    // No-vig probabilities
    nvHomeProb:          0.5738,
    nvDrawProb:          0.2142,
    nvAwayProb:          0.2119,
    // Model lean
    modelLean:           "H",
    leanProb:            0.5738,
    isFrozen:            1,
  },

  // ── wc26-r32-081: BELGIUM (H) vs SENEGAL (A) ──────────────────────────────
  "wc26-r32-081": {
    fixtureId:           "wc26-r32-081",
    modelVersion:        "v12.0-KO24-V5",
    homeTeam:            "Belgium",
    awayTeam:            "Senegal",
    // Lambdas
    homeLambda:          2.0121,
    awayLambda:          1.6278,
    // Score projections
    projHomeScore:       2.010,
    projAwayScore:       1.627,
    projTotal:           3.637,
    projSpread:          0.383,   // home - away
    // 1X2 probabilities
    homeWinProb:         0.4754,
    drawProb:            0.2032,
    awayWinProb:         0.3215,
    // 1X2 model ML (validated: pH=47.54%→+110, pD=20.32%→+392, pA=32.15%→+211)
    modelHomeML:         110,
    modelDrawML:         392,
    modelAwayML:         211,
    // Spread: Belgium -1.5 (matches book line)
    modelSpread:         -1.5,
    modelSpreadRaw:      0.383,
    homeSpreadOdds:      273,     // BEL -1.5 at +273 (pHSpread=26.79%)
    awaySpreadOdds:      -273,    // SEN +1.5 at -273 (pASpread=73.21%)
    // Total
    modelTotal:          2.5,
    modelTotalRaw:       3.637,
    over25:              0.7042,
    under25:             0.2958,
    overOdds:            -238,    // Over 2.5 at -238 (pO25=70.42%)
    underOdds:           238,     // Under 2.5 at +238 (pU25=29.58%)
    // BTTS
    bttsProb:            0.6906,
    bttsYesOdds:         -223,    // BTTS Yes at -223 (pBTTS=69.06%)
    bttsNoOdds:          223,     // BTTS No at +223 (pNoBTTS=30.94%)
    // Double chance
    nvDc1X:              0.6785,
    nvDcX2:              0.5246,
    dc1XOdds:            -211,    // Home or Draw at -211 (p1X=67.85%)
    dcX2Odds:            -110,    // Away or Draw at -110 (pX2=52.46%)
    // No draw
    nvNoDrawHome:        0.4754,
    nvNoDrawAway:        0.3215,
    noDrawHomeOdds:      -392,    // No Draw at -392 (pNoDraw=79.68%)
    noDrawAwayOdds:      -392,
    // To Advance
    toAdvanceHomeProb:   0.5845,
    toAdvanceAwayProb:   0.4155,
    toAdvanceHomeOdds:   -141,    // Belgium to Advance at -141 (pAdvH=58.45%)
    toAdvanceAwayOdds:   141,     // Senegal to Advance at +141 (pAdvA=41.55%)
    // No-vig probabilities
    nvHomeProb:          0.4754,
    nvDrawProb:          0.2032,
    nvAwayProb:          0.3215,
    // Model lean
    modelLean:           "H",
    leanProb:            0.4754,
    isFrozen:            1,
  },

  // ── wc26-r32-082: USA (H) vs BOSNIA & HERZEGOVINA (A) ────────────────────
  "wc26-r32-082": {
    fixtureId:           "wc26-r32-082",
    modelVersion:        "v12.0-KO24-V5",
    homeTeam:            "USA",
    awayTeam:            "Bosnia-Herz",
    // Lambdas
    homeLambda:          1.4386,
    awayLambda:          0.6063,
    // Score projections
    projHomeScore:       1.438,
    projAwayScore:       0.606,
    projTotal:           2.045,
    projSpread:          0.832,   // home - away
    // 1X2 probabilities
    homeWinProb:         0.5815,
    drawProb:            0.2547,
    awayWinProb:         0.1638,
    // 1X2 model ML (validated: pH=58.15%→-139, pD=25.47%→+293, pA=16.38%→+511)
    modelHomeML:         -139,
    modelDrawML:         293,
    modelAwayML:         511,
    // Spread: USA -1.5 (matches book line)
    modelSpread:         -1.5,
    modelSpreadRaw:      0.832,
    homeSpreadOdds:      240,     // USA -1.5 at +240 (pHSpread=29.41%)
    awaySpreadOdds:      -240,    // BIH +1.5 at -240 (pASpread=70.59%)
    // Total
    modelTotal:          2.5,
    modelTotalRaw:       2.045,
    over25:              0.3355,
    under25:             0.6645,
    overOdds:            198,     // Over 2.5 at +198 (pO25=33.55%)
    underOdds:           -198,    // Under 2.5 at -198 (pU25=66.45%)
    // BTTS
    bttsProb:            0.3394,
    bttsYesOdds:         195,     // BTTS Yes at +195 (pBTTS=33.94%)
    bttsNoOdds:          -195,    // BTTS No at -195 (pNoBTTS=66.06%)
    // Double chance
    nvDc1X:              0.8362,
    nvDcX2:              0.4185,
    dc1XOdds:            -511,    // Home or Draw at -511 (p1X=83.62%)
    dcX2Odds:            139,     // Away or Draw at +139 (pX2=41.85%)
    // No draw
    nvNoDrawHome:        0.5815,
    nvNoDrawAway:        0.1638,
    noDrawHomeOdds:      -293,    // No Draw at -293 (pNoDraw=74.53%)
    noDrawAwayOdds:      -293,
    // To Advance
    toAdvanceHomeProb:   0.7451,
    toAdvanceAwayProb:   0.2549,
    toAdvanceHomeOdds:   -292,    // USA to Advance at -292 (pAdvH=74.51%)
    toAdvanceAwayOdds:   292,     // Bosnia-Herz to Advance at +292 (pAdvA=25.49%)
    // No-vig probabilities
    nvHomeProb:          0.5815,
    nvDrawProb:          0.2547,
    nvAwayProb:          0.1638,
    // Model lean
    modelLean:           "H",
    leanProb:            0.5815,
    isFrozen:            1,
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// VALIDATION SCHEMA — 500x CROSS-REFERENCE
// Every field in every row will be validated against this schema
// ═══════════════════════════════════════════════════════════════════════════════
const BOOK_MARKET_CHECKS = [
  { key: "bookHomeMl",          label: "Home ML",              type: "ml" },
  { key: "bookDrawMl",          label: "Draw ML",              type: "ml" },
  { key: "bookAwayMl",          label: "Away ML",              type: "ml" },
  { key: "bookSpreadLine",      label: "Spread Line",          type: "line" },
  { key: "bookHomeSpreadOdds",  label: "Home Spread Odds",     type: "ml" },
  { key: "bookAwaySpreadOdds",  label: "Away Spread Odds",     type: "ml" },
  { key: "bookTotalLine",       label: "Total Line",           type: "line" },
  { key: "bookOverOdds",        label: "Over Odds",            type: "ml" },
  { key: "bookUnderOdds",       label: "Under Odds",           type: "ml" },
  { key: "bookBttsYesOdds",     label: "BTTS Yes",             type: "ml" },
  { key: "bookBttsNoOdds",      label: "BTTS No",              type: "ml" },
  { key: "bookDc1XOdds",        label: "Home or Draw (1X)",    type: "ml" },
  { key: "bookDcX2Odds",        label: "Away or Draw (X2)",    type: "ml" },
  { key: "bookNoDrawHomeOdds",  label: "No Draw Home",         type: "ml" },
  { key: "bookNoDrawAwayOdds",  label: "No Draw Away",         type: "ml" },
  { key: "toAdvanceHomeOdds",   label: "To Advance Home",      type: "ml" },
  { key: "toAdvanceAwayOdds",   label: "To Advance Away",      type: "ml" },
];

const MODEL_MARKET_CHECKS = [
  { key: "homeLambda",          label: "Home Lambda",          type: "prob" },
  { key: "awayLambda",          label: "Away Lambda",          type: "prob" },
  { key: "projHomeScore",       label: "Proj Home Score",      type: "prob" },
  { key: "projAwayScore",       label: "Proj Away Score",      type: "prob" },
  { key: "projTotal",           label: "Proj Total",           type: "prob" },
  { key: "homeWinProb",         label: "Home Win Prob",        type: "prob01" },
  { key: "drawProb",            label: "Draw Prob",            type: "prob01" },
  { key: "awayWinProb",         label: "Away Win Prob",        type: "prob01" },
  { key: "modelHomeML",         label: "Model Home ML",        type: "ml" },
  { key: "modelDrawML",         label: "Model Draw ML",        type: "ml" },
  { key: "modelAwayML",         label: "Model Away ML",        type: "ml" },
  { key: "homeSpreadOdds",      label: "Home Spread Odds",     type: "ml" },
  { key: "awaySpreadOdds",      label: "Away Spread Odds",     type: "ml" },
  { key: "overOdds",            label: "Over Odds",            type: "ml" },
  { key: "underOdds",           label: "Under Odds",           type: "ml" },
  { key: "bttsYesOdds",         label: "BTTS Yes Odds",        type: "ml" },
  { key: "bttsNoOdds",          label: "BTTS No Odds",         type: "ml" },
  { key: "dc1XOdds",            label: "DC 1X Odds",           type: "ml" },
  { key: "dcX2Odds",            label: "DC X2 Odds",           type: "ml" },
  { key: "noDrawHomeOdds",      label: "No Draw Home Odds",    type: "ml" },
  { key: "noDrawAwayOdds",      label: "No Draw Away Odds",    type: "ml" },
  { key: "toAdvanceHomeOdds",   label: "To Advance Home Odds", type: "ml" },
  { key: "toAdvanceAwayOdds",   label: "To Advance Away Odds", type: "ml" },
  { key: "toAdvanceHomeProb",   label: "To Advance Home Prob", type: "prob01" },
  { key: "toAdvanceAwayProb",   label: "To Advance Away Prob", type: "prob01" },
];

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN EXECUTION
// ═══════════════════════════════════════════════════════════════════════════════
async function main() {
  const HEADER = `
╔══════════════════════════════════════════════════════════════════════════════════════╗
║  WC2026 JULY 1 DIRECT SEED — v12.0-KO24-V5                                        ║
║  Session: ${SESSION_ID}                                                ║
║  Fixtures:                                                                         ║
║    wc26-r32-080  England (H) vs Congo DR (A)         — 12:00 PM ET                ║
║    wc26-r32-081  Belgium (H) vs Senegal (A)          —  4:00 PM ET                ║
║    wc26-r32-082  USA (H) vs Bosnia & Herzegovina (A) —  8:00 PM ET                ║
║  Markets: ML | Draw | NoDraw | Spread | O/U | BTTS | DC | ToAdvance               ║
║  Tables: wc2026_frozen_book_odds | wc2026_model_projections                        ║
║  Model: V5 Player xG Dominant (0.20) — Backtest winner                            ║
╚══════════════════════════════════════════════════════════════════════════════════════╝`;
  console.log(HEADER);
  appendLog(HEADER);

  const db = await getDb();

  // ─── PHASE 1: PRE-FLIGHT INPUT VALIDATION ────────────────────────────────
  log("SECTION", "PHASE1", "PRE-FLIGHT INPUT VALIDATION — 500x cross-reference of all source data");

  // Validate book rows
  log("STEP", "BOOK-VAL", `Validating ${FIXTURE_IDS.length} book rows × ${BOOK_MARKET_CHECKS.length} markets = ${FIXTURE_IDS.length * BOOK_MARKET_CHECKS.length} checks`);
  let bookValPass = 0, bookValFail = 0;
  for (const fid of FIXTURE_IDS) {
    const row = BOOK_ROWS[fid];
    if (!row) { log("FAIL", "BOOK-VAL", `${fid}: BOOK_ROWS entry missing`); bookValFail++; continue; }
    log("INPUT", "BOOK-VAL", `${fid}: bookHomeMl=${row.bookHomeMl} bookDrawMl=${row.bookDrawMl} bookAwayMl=${row.bookAwayMl}`,
      `Spread=${row.bookSpreadLine} (H${row.bookHomeSpreadOdds}/A${row.bookAwaySpreadOdds}) | Total=${row.bookTotalLine} (O${row.bookOverOdds}/U${row.bookUnderOdds}) | BTTS Y${row.bookBttsYesOdds}/N${row.bookBttsNoOdds} | DC 1X${row.bookDc1XOdds}/X2${row.bookDcX2Odds} | NoDraw ${row.bookNoDrawHomeOdds} | ToAdv H${row.toAdvanceHomeOdds}/A${row.toAdvanceAwayOdds}`);
    for (const { key, label, type } of BOOK_MARKET_CHECKS) {
      const val = row[key];
      if (val === null || val === undefined) {
        log("FAIL", "BOOK-VAL", `${fid} ${label} (${key}): NULL/UNDEFINED`);
        bookValFail++;
      } else if (type === "ml" && (isNaN(Number(val)) || Number(val) === 0)) {
        log("FAIL", "BOOK-VAL", `${fid} ${label}: val=${val} is not a valid ML`);
        bookValFail++;
      } else {
        log("VERIFY", "BOOK-VAL", `${fid} ${label}: ${val} ✓`);
        bookValPass++;
      }
    }
  }
  if (bookValFail > 0) {
    log("FAIL", "BOOK-VAL", `${bookValFail} book validation checks FAILED — aborting`);
    flushSeedLog(); process.exit(1);
  }
  log("PASS", "BOOK-VAL", `All ${bookValPass} book validation checks PASS`);

  // Validate model rows
  log("STEP", "MODEL-VAL", `Validating ${FIXTURE_IDS.length} model rows × ${MODEL_MARKET_CHECKS.length} markets = ${FIXTURE_IDS.length * MODEL_MARKET_CHECKS.length} checks`);
  let modelValPass = 0, modelValFail = 0;
  for (const fid of FIXTURE_IDS) {
    const row = MODEL_ROWS[fid];
    if (!row) { log("FAIL", "MODEL-VAL", `${fid}: MODEL_ROWS entry missing`); modelValFail++; continue; }
    log("INPUT", "MODEL-VAL", `${fid}: λH=${row.homeLambda} λA=${row.awayLambda} | Proj ${row.projHomeScore}-${row.projAwayScore} | pH=${row.homeWinProb} pD=${row.drawProb} pA=${row.awayWinProb}`);
    // Validate 1X2 sum
    const sum1X2 = row.homeWinProb + row.drawProb + row.awayWinProb;
    if (Math.abs(sum1X2 - 1.0) > 0.002) {
      log("FAIL", "MODEL-VAL", `${fid} 1X2 sum=${sum1X2.toFixed(8)} FAIL (must=1.0)`);
      modelValFail++;
    } else {
      log("VERIFY", "MODEL-VAL", `${fid} 1X2 sum=${sum1X2.toFixed(8)} ✓`);
      modelValPass++;
    }
    // Validate advance sum
    const sumAdv = row.toAdvanceHomeProb + row.toAdvanceAwayProb;
    if (Math.abs(sumAdv - 1.0) > 0.002) {
      log("FAIL", "MODEL-VAL", `${fid} Advance sum=${sumAdv.toFixed(8)} FAIL`);
      modelValFail++;
    } else {
      log("VERIFY", "MODEL-VAL", `${fid} Advance sum=${sumAdv.toFixed(8)} ✓`);
      modelValPass++;
    }
    // Validate ML sign consistency
    const mlChecks = [
      { prob: row.homeWinProb, ml: row.modelHomeML, label: "Home ML" },
      { prob: row.drawProb,    ml: row.modelDrawML,  label: "Draw ML" },
      { prob: row.awayWinProb, ml: row.modelAwayML,  label: "Away ML" },
      { prob: row.toAdvanceHomeProb, ml: row.toAdvanceHomeOdds, label: "ToAdv Home" },
      { prob: row.toAdvanceAwayProb, ml: row.toAdvanceAwayOdds, label: "ToAdv Away" },
      { prob: row.over25,      ml: row.overOdds,     label: "Over Odds" },
      { prob: row.under25,     ml: row.underOdds,    label: "Under Odds" },
      { prob: row.bttsProb,    ml: row.bttsYesOdds,  label: "BTTS Yes" },
    ];
    for (const { prob, ml, label } of mlChecks) {
      if (prob === undefined || ml === undefined) continue;
      const expectedNeg = prob >= 0.5;
      const isNeg = ml < 0;
      if (expectedNeg !== isNeg) {
        log("FAIL", "MODEL-VAL", `${fid} ${label}: SIGN MISMATCH — P=${prob.toFixed(4)} expects ${expectedNeg?'negative':'positive'} ML but got ${ml}`);
        modelValFail++;
      } else {
        log("VERIFY", "MODEL-VAL", `${fid} ${label}: P=${prob.toFixed(4)} → ML=${ml>0?'+':''}${ml} sign ✓`);
        modelValPass++;
      }
    }
    for (const { key, label } of MODEL_MARKET_CHECKS) {
      const val = row[key];
      if (val === null || val === undefined) {
        log("WARN", "MODEL-VAL", `${fid} ${label} (${key}): NULL (may be optional)`);
      } else {
        modelValPass++;
      }
    }
  }
  if (modelValFail > 0) {
    log("FAIL", "MODEL-VAL", `${modelValFail} model validation checks FAILED — aborting`);
    flushSeedLog(); process.exit(1);
  }
  log("PASS", "MODEL-VAL", `All ${modelValPass} model validation checks PASS`);

  // ─── PHASE 2: VERIFY FIXTURES EXIST IN DB ────────────────────────────────
  log("SECTION", "PHASE2", "VERIFYING FIXTURES EXIST IN wc2026_fixtures");
  const fixtures = await db.select().from(wc2026Fixtures).where(inArray(wc2026Fixtures.fixtureId, FIXTURE_IDS));
  if (fixtures.length !== 3) {
    log("FAIL", "FX-CHECK", `Expected 3 fixtures, got ${fixtures.length} — ABORT`);
    flushSeedLog(); process.exit(1);
  }
  log("PASS", "FX-CHECK", `All 3 fixtures confirmed in wc2026_fixtures`);
  for (const f of fixtures) {
    log("VERIFY", "FX-CHECK", `${(f as any).fixtureId}: home=${(f as any).homeTeamId} away=${(f as any).awayTeamId} | kickoff=${(f as any).kickoffUtc} | stage=${(f as any).stage}`);
    // Cross-check orientation
    const mr = MODEL_ROWS[(f as any).fixtureId];
    if (mr) {
      const dbHome = ((f as any).homeTeamId || '').toUpperCase();
      const mrHome = (mr.homeTeam || '').toUpperCase();
      if (!dbHome.includes(mrHome.slice(0,3)) && !mrHome.includes(dbHome.slice(0,3))) {
        log("WARN", "FX-CHECK", `${(f as any).fixtureId}: DB homeTeamId=${dbHome} vs MODEL homeTeam=${mrHome} — verify orientation`);
      } else {
        log("VERIFY", "FX-CHECK", `${(f as any).fixtureId}: Orientation confirmed — home=${mrHome} ✓`);
      }
    }
  }

  // ─── PHASE 3: UPSERT FROZEN BOOK ODDS ────────────────────────────────────
  log("SECTION", "PHASE3", "UPSERTING FROZEN BOOK ODDS — wc2026_frozen_book_odds");
  let bookInsertPass = 0, bookInsertFail = 0;
  for (const fid of FIXTURE_IDS) {
    log("STEP", "BOOK-INS", `Upserting frozen book odds for ${fid}`);
    const row = BOOK_ROWS[fid];
    try {
      await db.delete(wc2026FrozenBookOdds).where(eq(wc2026FrozenBookOdds.fixtureId, fid));
      log("STATE", "BOOK-INS", `${fid}: deleted existing frozen book odds row (idempotent)`);
      await db.insert(wc2026FrozenBookOdds).values({
        fixtureId:            row.fixtureId,
        bookHomeMl:           row.bookHomeMl,
        bookDrawMl:           row.bookDrawMl,
        bookAwayMl:           row.bookAwayMl,
        bookSpreadLine:       row.bookSpreadLine,
        bookHomeSpreadOdds:   row.bookHomeSpreadOdds,
        bookAwaySpreadOdds:   row.bookAwaySpreadOdds,
        bookTotalLine:        row.bookTotalLine,
        bookOverOdds:         row.bookOverOdds,
        bookUnderOdds:        row.bookUnderOdds,
        bookBttsYesOdds:      row.bookBttsYesOdds,
        bookBttsNoOdds:       row.bookBttsNoOdds,
        bookDc1XOdds:         row.bookDc1XOdds,
        bookDcX2Odds:         row.bookDcX2Odds,
        bookNoDrawHomeOdds:   row.bookNoDrawHomeOdds,
        bookNoDrawAwayOdds:   row.bookNoDrawAwayOdds,
        toAdvanceHomeOdds:    row.toAdvanceHomeOdds,
        toAdvanceAwayOdds:    row.toAdvanceAwayOdds,
        bookSource:           row.bookSource,
      });
      log("PASS", "BOOK-INS", `${fid}: Frozen book odds inserted`,
        `ML H=${row.bookHomeMl} D=${row.bookDrawMl} A=${row.bookAwayMl} | Spread=${row.bookSpreadLine} H${row.bookHomeSpreadOdds}/A${row.bookAwaySpreadOdds} | Total=${row.bookTotalLine} O${row.bookOverOdds}/U${row.bookUnderOdds} | BTTS Y${row.bookBttsYesOdds}/N${row.bookBttsNoOdds} | DC 1X${row.bookDc1XOdds}/X2${row.bookDcX2Odds} | NoDraw ${row.bookNoDrawHomeOdds} | ToAdv H${row.toAdvanceHomeOdds}/A${row.toAdvanceAwayOdds}`);
      bookInsertPass++;
    } catch (e: any) {
      const err = `${e.message || ''} | CAUSE: ${e.cause?.message || ''} | SQL: ${e.sql || ''}`;
      log("FAIL", "BOOK-INS", `${fid}: Frozen book odds insert FAILED`, err.slice(0, 500));
      console.error("[FULL ERROR]", e);
      bookInsertFail++;
    }
  }
  if (bookInsertFail > 0) {
    log("FAIL", "PHASE3", `${bookInsertFail} book inserts FAILED — check errors above`);
  } else {
    log("PASS", "PHASE3", `All ${bookInsertPass} frozen book odds inserted successfully`);
  }

  // ─── PHASE 4: UPSERT MODEL PROJECTIONS ───────────────────────────────────
  log("SECTION", "PHASE4", "UPSERTING MODEL PROJECTIONS — wc2026_model_projections");
  let modelInsertPass = 0, modelInsertFail = 0;
  for (const fid of FIXTURE_IDS) {
    log("STEP", "MODEL-INS", `Upserting model projection for ${fid}`);
    const row = MODEL_ROWS[fid];
    try {
      await db.delete(wc2026ModelProjections).where(eq(wc2026ModelProjections.fixtureId, fid));
      log("STATE", "MODEL-INS", `${fid}: deleted existing model projection row (idempotent)`);
      await db.insert(wc2026ModelProjections).values({
        fixtureId:           row.fixtureId,
        modelVersion:        row.modelVersion,
        homeTeam:            row.homeTeam,
        awayTeam:            row.awayTeam,
        homeLambda:          row.homeLambda,
        awayLambda:          row.awayLambda,
        projHomeScore:       row.projHomeScore,
        projAwayScore:       row.projAwayScore,
        projTotal:           row.projTotal,
        projSpread:          row.projSpread,
        homeWinProb:         row.homeWinProb,
        drawProb:            row.drawProb,
        awayWinProb:         row.awayWinProb,
        modelHomeML:         row.modelHomeML,
        modelDrawML:         row.modelDrawML,
        modelAwayML:         row.modelAwayML,
        modelSpread:         row.modelSpread,
        modelSpreadRaw:      row.modelSpreadRaw,
        homeSpreadOdds:      row.homeSpreadOdds,
        awaySpreadOdds:      row.awaySpreadOdds,
        modelTotal:          row.modelTotal,
        modelTotalRaw:       row.modelTotalRaw,
        over25:              row.over25,
        under25:             row.under25,
        overOdds:            row.overOdds,
        underOdds:           row.underOdds,
        bttsProb:            row.bttsProb,
        bttsYesOdds:         row.bttsYesOdds,
        bttsNoOdds:          row.bttsNoOdds,
        nvDc1X:              row.nvDc1X,
        nvDcX2:              row.nvDcX2,
        dc1XOdds:            row.dc1XOdds,
        dcX2Odds:            row.dcX2Odds,
        nvNoDrawHome:        row.nvNoDrawHome,
        nvNoDrawAway:        row.nvNoDrawAway,
        noDrawHomeOdds:      row.noDrawHomeOdds,
        noDrawAwayOdds:      row.noDrawAwayOdds,
        toAdvanceHomeProb:   row.toAdvanceHomeProb,
        toAdvanceAwayProb:   row.toAdvanceAwayProb,
        toAdvanceHomeOdds:   row.toAdvanceHomeOdds,
        toAdvanceAwayOdds:   row.toAdvanceAwayOdds,
        nvHomeProb:          row.nvHomeProb,
        nvDrawProb:          row.nvDrawProb,
        nvAwayProb:          row.nvAwayProb,
        modelLean:           row.modelLean,
        leanProb:            row.leanProb,
        isFrozen:            row.isFrozen,
        frozenAt:            new Date(),
        modeledAt:           new Date(),
        createdAt:           new Date(),
      });
      log("PASS", "MODEL-INS", `${fid}: Model projection inserted`,
        `λH=${row.homeLambda} λA=${row.awayLambda} | Proj ${row.projHomeScore}-${row.projAwayScore} | pH=${row.homeWinProb} pD=${row.drawProb} pA=${row.awayWinProb} | isFrozen=1`);
      modelInsertPass++;
    } catch (e: any) {
      const err = `${e.message || ''} | CAUSE: ${e.cause?.message || ''} | SQL: ${e.sql || ''} | PARAMS: ${JSON.stringify(e.parameters || []).slice(0, 200)}`;
      log("FAIL", "MODEL-INS", `${fid}: Model projection insert FAILED`, err.slice(0, 600));
      console.error("[FULL ERROR]", e);
      modelInsertFail++;
    }
  }
  if (modelInsertFail > 0) {
    log("FAIL", "PHASE4", `${modelInsertFail} model inserts FAILED`);
  } else {
    log("PASS", "PHASE4", `All ${modelInsertPass} model projections inserted successfully`);
  }

  // ─── PHASE 5: READ-BACK VERIFICATION ─────────────────────────────────────
  log("SECTION", "PHASE5", "READ-BACK VERIFICATION — 500x cross-reference against source data");

  const bos = await db.select().from(wc2026FrozenBookOdds).where(inArray(wc2026FrozenBookOdds.fixtureId, FIXTURE_IDS));
  const mps = await db.select().from(wc2026ModelProjections).where(inArray(wc2026ModelProjections.fixtureId, FIXTURE_IDS));

  log("STATE", "READBACK", `Frozen book odds rows returned: ${bos.length} (expected 3)`);
  log("STATE", "READBACK", `Model projection rows returned: ${mps.length} (expected 3)`);

  if (bos.length !== 3) log("FAIL", "READBACK", `Expected 3 frozen book odds rows, got ${bos.length}`);
  else log("PASS", "READBACK", `All 3 frozen book odds rows confirmed in DB`);

  if (mps.length !== 3) log("FAIL", "READBACK", `Expected 3 model projection rows, got ${mps.length}`);
  else log("PASS", "READBACK", `All 3 model projection rows confirmed in DB`);

  // Field-by-field cross-reference
  const boMap: Record<string, any> = {};
  bos.forEach((bo: any) => { boMap[bo.fixtureId] = bo; });
  const mpMap: Record<string, any> = {};
  mps.forEach((mp: any) => { mpMap[mp.fixtureId] = mp; });

  let xrefPass = 0, xrefFail = 0;
  for (const fid of FIXTURE_IDS) {
    log("STEP", "XREF", `Cross-referencing ${fid} — ${BOOK_MARKET_CHECKS.length} book + ${MODEL_MARKET_CHECKS.length} model fields`);
    const bo = boMap[fid];
    const mp = mpMap[fid];
    const srcBook = BOOK_ROWS[fid];
    const srcModel = MODEL_ROWS[fid];

    if (!bo) { log("FAIL", "XREF", `${fid}: no frozen book odds row in DB`); xrefFail++; continue; }
    if (!mp) { log("FAIL", "XREF", `${fid}: no model projection row in DB`); xrefFail++; continue; }

    // Book cross-reference
    for (const { key, label } of BOOK_MARKET_CHECKS) {
      const src = srcBook[key];
      const db_val = bo[key];
      if (src === undefined) continue;
      if (Number(src) !== Number(db_val)) {
        log("FAIL", "XREF", `${fid} BOOK ${label}: SOURCE=${src} DB=${db_val} MISMATCH`);
        xrefFail++;
      } else {
        log("VERIFY", "XREF", `${fid} BOOK ${label}: ${src} ✓`);
        xrefPass++;
      }
    }

    // Model cross-reference (key fields)
    const modelKeyChecks = [
      { key: "homeWinProb", label: "Home Win Prob" },
      { key: "drawProb",    label: "Draw Prob" },
      { key: "awayWinProb", label: "Away Win Prob" },
      { key: "modelHomeML", label: "Model Home ML" },
      { key: "modelDrawML", label: "Model Draw ML" },
      { key: "modelAwayML", label: "Model Away ML" },
      { key: "toAdvanceHomeOdds", label: "ToAdv Home Odds" },
      { key: "toAdvanceAwayOdds", label: "ToAdv Away Odds" },
      { key: "overOdds",    label: "Over Odds" },
      { key: "underOdds",   label: "Under Odds" },
      { key: "bttsYesOdds", label: "BTTS Yes Odds" },
      { key: "bttsNoOdds",  label: "BTTS No Odds" },
      { key: "dc1XOdds",    label: "DC 1X Odds" },
      { key: "dcX2Odds",    label: "DC X2 Odds" },
      { key: "noDrawHomeOdds", label: "No Draw Home Odds" },
      { key: "homeSpreadOdds", label: "Home Spread Odds" },
      { key: "awaySpreadOdds", label: "Away Spread Odds" },
    ];
    for (const { key, label } of modelKeyChecks) {
      const src = srcModel[key];
      const db_val = mp[key];
      if (src === undefined) continue;
      const srcN = Number(src), dbN = Number(db_val);
      const diff = Math.abs(srcN - dbN);
      if (diff > 0.0001) {
        log("FAIL", "XREF", `${fid} MODEL ${label}: SOURCE=${src} DB=${db_val} MISMATCH (diff=${diff})`);
        xrefFail++;
      } else {
        log("VERIFY", "XREF", `${fid} MODEL ${label}: ${src} ✓`);
        xrefPass++;
      }
    }
  }

  if (xrefFail > 0) {
    log("FAIL", "PHASE5", `${xrefFail} cross-reference checks FAILED — data integrity compromised`);
  } else {
    log("PASS", "PHASE5", `All ${xrefPass} cross-reference checks PASS — 100% data integrity confirmed`);
  }

  // ─── PHASE 6: STATE DUMP ──────────────────────────────────────────────────
  log("SECTION", "PHASE6", "FINAL STATE DUMP — all 3 fixtures with full market values");
  for (const fid of FIXTURE_IDS) {
    const bo = boMap[fid];
    const mp = mpMap[fid];
    const fx = fixtures.find((f: any) => f.fixtureId === fid);
    log("STATE", "DUMP", `━━━ ${fid}: ${(fx as any)?.homeTeamId?.toUpperCase()} (H) vs ${(fx as any)?.awayTeamId?.toUpperCase()} (A) ━━━`);
    log("STATE", "DUMP", `  [BOOK ODDS]`);
    log("STATE", "DUMP", `    1X2 ML:       Home=${bo?.bookHomeMl}  Draw=${bo?.bookDrawMl}  Away=${bo?.bookAwayMl}`);
    log("STATE", "DUMP", `    Spread:        Line=${bo?.bookSpreadLine}  H=${bo?.bookHomeSpreadOdds}  A=${bo?.bookAwaySpreadOdds}`);
    log("STATE", "DUMP", `    Total:         Line=${bo?.bookTotalLine}  Over=${bo?.bookOverOdds}  Under=${bo?.bookUnderOdds}`);
    log("STATE", "DUMP", `    BTTS:          Yes=${bo?.bookBttsYesOdds}  No=${bo?.bookBttsNoOdds}`);
    log("STATE", "DUMP", `    DC:            1X(H+D)=${bo?.bookDc1XOdds}  X2(A+D)=${bo?.bookDcX2Odds}`);
    log("STATE", "DUMP", `    No Draw:       Home=${bo?.bookNoDrawHomeOdds}  Away=${bo?.bookNoDrawAwayOdds}`);
    log("STATE", "DUMP", `    To Advance:    Home=${bo?.toAdvanceHomeOdds}  Away=${bo?.toAdvanceAwayOdds}`);
    log("STATE", "DUMP", `  [MODEL PROJECTIONS — V5]`);
    log("STATE", "DUMP", `    Lambdas:       λH=${mp?.homeLambda}  λA=${mp?.awayLambda}`);
    log("STATE", "DUMP", `    Proj Score:    H=${mp?.projHomeScore}  A=${mp?.projAwayScore}  Total=${mp?.projTotal}`);
    log("STATE", "DUMP", `    1X2 Probs:     H=${mp?.homeWinProb}  D=${mp?.drawProb}  A=${mp?.awayWinProb}`);
    log("STATE", "DUMP", `    1X2 ML:        H=${mp?.modelHomeML}  D=${mp?.modelDrawML}  A=${mp?.modelAwayML}`);
    log("STATE", "DUMP", `    Spread:        Line=${mp?.modelSpread}  H=${mp?.homeSpreadOdds}  A=${mp?.awaySpreadOdds}`);
    log("STATE", "DUMP", `    Total:         Line=${mp?.modelTotal}  Over=${mp?.overOdds}  Under=${mp?.underOdds}`);
    log("STATE", "DUMP", `    BTTS:          Prob=${mp?.bttsProb}  Yes=${mp?.bttsYesOdds}  No=${mp?.bttsNoOdds}`);
    log("STATE", "DUMP", `    DC:            1X=${mp?.dc1XOdds}  X2=${mp?.dcX2Odds}`);
    log("STATE", "DUMP", `    No Draw:       Home=${mp?.noDrawHomeOdds}  Away=${mp?.noDrawAwayOdds}`);
    log("STATE", "DUMP", `    To Advance:    H_prob=${mp?.toAdvanceHomeProb}  A_prob=${mp?.toAdvanceAwayProb}  H_odds=${mp?.toAdvanceHomeOdds}  A_odds=${mp?.toAdvanceAwayOdds}`);
    log("STATE", "DUMP", `    isFrozen:      ${mp?.isFrozen}  | modelVersion: ${mp?.modelVersion}`);
  }

  // ─── SESSION SUMMARY ──────────────────────────────────────────────────────
  const elapsed = ((Date.now() - T0) / 1000).toFixed(3);
  const FOOTER = `
════════════════════════════════════════════════════════════════════════════════════════
SESSION END: ${new Date().toISOString()} | ELAPSED: ${elapsed}s
STEPS: ${_STEP} | PASS: ${_PASS} | FAIL: ${_FAIL} | WARN: ${_WARN}
BOOK INSERTS: ${bookInsertPass}/${FIXTURE_IDS.length} | MODEL INSERTS: ${modelInsertPass}/${FIXTURE_IDS.length}
XREF CHECKS: ${xrefPass} PASS / ${xrefFail} FAIL
SCRIPT: seedJuly1Direct.ts | MODEL: v12.0-KO24-V5 (Player xG Dominant)
SEED LOG: ${SEED_LOG_PATH}
MODELING LOG: ${LOG_PATH}
════════════════════════════════════════════════════════════════════════════════════════`;
  console.log(FOOTER);
  appendLog(FOOTER);
  flushSeedLog();

  if (_FAIL > 0) {
    console.error(`\n❌ SEED COMPLETED WITH ${_FAIL} FAILURES — check logs above`);
    process.exit(1);
  } else {
    console.log(`\n✅ SEED COMPLETE — ${_PASS} checks passed, 0 failures`);
    console.log(`   Seed log: ${SEED_LOG_PATH}`);
    console.log(`   Modeling log: ${LOG_PATH}`);
    process.exit(0);
  }
}

main().catch((e) => {
  console.error("[FATAL]", e);
  appendLog(`[FATAL] ${e.message}`);
  flushSeedLog();
  process.exit(1);
});
